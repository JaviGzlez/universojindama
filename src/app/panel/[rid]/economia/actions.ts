"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { getRestaurante } from "@/lib/contexto";
import { dec } from "@/lib/engine/decimal";
import { detectarAnio, leerAnalitica } from "@/lib/importar/analitica";
import { leerLibro } from "@/lib/importar/excel";

const t = () => Date.now();
const fallo = (m: string, errores?: Record<string, string>): ResultadoAccion => ({ ok: false, mensaje: m, errores, t: t() });
const errorBD = (e: { message: string; code?: string }) =>
  fallo(/row-level security/.test(e.message) || e.code === "42501" ? "No tienes permiso para el control económico de este restaurante." : e.message);

const Movimiento = z.object({
  rid: z.string().uuid(), entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
  kind: z.enum(["revenue", "purchase", "labor", "expense"]), nature: z.enum(["operating", "financing", "investment"]),
  category: z.string().trim().min(1, "Indica la categoría").max(80), counterparty: z.string().trim().max(120).optional(),
  amount: z.string().refine((v) => dec(v) !== null, "Importe no válido"), quality: z.enum(["real", "estimated"]),
  notes: z.string().max(300).optional(),
});

export async function crearMovimiento(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Movimiento.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos no válidos");
  const { rid, ...d } = p.data;
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("financial_entries").insert({
    ...d, restaurant_id: rid, amount: dec(d.amount)!.toDecimalPlaces(2).toString(), counterparty: d.counterparty || null, notes: d.notes || null, source: "manual",
  });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/economia`, "layout");
  return { ok: true, mensaje: "Movimiento guardado.", t: t() };
}

export async function borrarMovimiento(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { data, error } = await r.ctx.supabase.from("financial_entries").delete().eq("id", String(form.get("id"))).eq("source", "manual").select("id");
  if (error) return errorBD(error);
  if (!data?.length) return fallo("Solo se pueden borrar movimientos manuales (los importados se deshacen desde la importación).");
  revalidatePath(`/panel/${rid}/economia`, "layout");
  return { ok: true, mensaje: "Movimiento borrado.", t: t() };
}

export async function cambiarPeriodo(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const [y, m] = String(form.get("mes")).split("-").map(Number);
  const estado = String(form.get("estado"));
  const { error } = await r.ctx.supabase.rpc("set_period_status", { p_restaurant: rid, p_year: y, p_month: m, p_status: estado });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/economia`, "layout");
  return { ok: true, mensaje: estado === "closed" ? "Periodo cerrado." : "Periodo reabierto.", t: t() };
}

// ------------------------------------------------------------- importación
export async function subirExcel(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return fallo("Elige el archivo Excel.");
  if (!/\.xlsx$/i.test(archivo.name)) return fallo("El archivo debe ser .xlsx.");
  if (archivo.size > 4_000_000) return fallo("El archivo es demasiado grande (máximo 4 MB).");
  const buf = await archivo.arrayBuffer();
  let hojas;
  try {
    hojas = await leerLibro(buf);
  } catch {
    return fallo("No se ha podido leer el Excel. Si está protegido con contraseña, guárdalo sin protección y vuelve a subirlo.");
  }
  const anioForm = Number(form.get("anio"));
  const anio = anioForm >= 2000 && anioForm <= 2100 ? anioForm : detectarAnio(hojas, archivo.name);
  const lectura = leerAnalitica(hojas, anio);
  if (lectura.filas.length === 0) return fallo("No se han encontrado datos con la estructura de analítica (hojas ENERO…DICIEMBRE).");

  const sb = r.ctx.supabase;
  const hash = createHash("sha256").update(Buffer.from(buf)).digest("hex");
  const { data: job, error } = await sb.from("import_jobs").insert({
    organization_id: r.restaurante.organization_id, kind: "analitica_excel", file_name: archivo.name, file_hash: hash, year: anio,
    summary: { bloques: lectura.bloques, avisos: lectura.avisos },
    rows_total: lectura.filas.length, rows_error: lectura.filas.filter((f) => f.status === "error").length,
  }).select("id").single();
  if (error) return errorBD(error);
  for (let i = 0; i < lectura.filas.length; i += 1000) {
    const { error: e2 } = await sb.from("import_rows").insert(lectura.filas.slice(i, i + 1000).map((f) => ({ ...f, job_id: job.id })));
    if (e2) {
      await sb.from("import_jobs").update({ status: "failed" }).eq("id", job.id);
      return errorBD(e2);
    }
  }
  redirect(`/panel/${rid}/economia/importar/${job.id}`);
}

export async function aplicarImportacion(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const job = String(form.get("job"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const mapping: Record<string, string | null> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("bloque_")) mapping[k.slice(7)] = String(v) || null;
  const destinos = Object.values(mapping).filter(Boolean);
  if (destinos.length === 0) return fallo("Asigna al menos un bloque a un restaurante.");
  if (new Set(destinos).size !== destinos.length) return fallo("Dos bloques no pueden ir al mismo restaurante.");
  const { data, error } = await r.ctx.supabase.rpc("apply_import", { p_job: job, p_mapping: mapping });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/economia`, "layout");
  revalidatePath("/panel");
  const d = data as { inserted: number; replaced: number };
  return { ok: true, mensaje: `Importación aplicada: ${d.inserted} movimientos${d.replaced ? ` (sustituyen ${d.replaced} de una importación anterior)` : ""}.`, t: t() };
}

export async function deshacerImportacion(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { data, error } = await r.ctx.supabase.rpc("revert_import", { p_job: String(form.get("job")) });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/economia`, "layout");
  revalidatePath("/panel");
  return { ok: true, mensaje: `Importación deshecha: ${data} movimientos eliminados.`, t: t() };
}
