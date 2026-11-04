"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { getRestaurante } from "@/lib/contexto";
import { dec } from "@/lib/engine/decimal";
import { leerVentasCsv, normalizarNombre } from "@/lib/ventas-csv";

const t = () => Date.now();
const fallo = (m: string, errores?: Record<string, string>): ResultadoAccion => ({ ok: false, mensaje: m, errores, t: t() });
const errorBD = (e: { message: string; code?: string }) =>
  fallo(/row-level security/.test(e.message) || e.code === "42501" ? "No tienes permiso para registrar ventas en este restaurante." : e.message);

const Venta = z.object({
  rid: z.string().uuid(), sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), menu_item_id: z.string().uuid("Elige plato"),
  channel_id: z.string().optional(), quantity: z.string().refine((v) => dec(v)?.greaterThan(0) ?? false, "Cantidad no válida"),
  gross_amount: z.string().optional(),
});

export async function registrarVenta(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Venta.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos no válidos");
  const d = p.data;
  const r = await getRestaurante(d.rid);
  if (!r) return fallo("Sin acceso.");
  const importe = d.gross_amount?.trim() ? dec(d.gross_amount) : null;
  if (d.gross_amount?.trim() && (importe === null || importe.lessThan(0))) return fallo("Importe no válido");
  const { error } = await r.ctx.supabase.from("sales").insert({
    restaurant_id: d.rid, sale_date: d.sale_date, menu_item_id: d.menu_item_id, channel_id: d.channel_id || null,
    quantity: dec(d.quantity)!.toString(), gross_amount: importe?.toString() ?? null, source: "manual",
  });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${d.rid}/ventas`);
  return { ok: true, mensaje: "Venta registrada.", t: t() };
}

export async function importarVentas(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const archivo = form.get("archivo");
  let texto = String(form.get("texto") ?? "");
  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > 5_000_000) return fallo("El archivo es demasiado grande (máximo 5 MB).");
    texto = await archivo.text();
  }
  if (!texto.trim()) return fallo("Pega el contenido o elige un archivo CSV.");
  const { filas, errores } = leerVentasCsv(texto);
  const sb = r.ctx.supabase;
  const [{ data: platos }, { data: canales }] = await Promise.all([
    sb.from("menu_items").select("id, name").eq("restaurant_id", rid).eq("status", "active"),
    sb.from("sales_channels").select("id, name").eq("restaurant_id", rid).eq("status", "active"),
  ]);
  const plato = new Map((platos ?? []).map((p) => [normalizarNombre(p.name), p.id as string]));
  const canal = new Map((canales ?? []).map((c) => [normalizarNombre(c.name), c.id as string]));
  const problemas = errores.map((e) => `Línea ${e.linea}: ${e.error}`);
  const insertar = [];
  for (const f of filas) {
    const pid = plato.get(normalizarNombre(f.plato));
    if (!pid) { problemas.push(`Línea ${f.linea}: el plato «${f.plato}» no está en la carta`); continue; }
    const cid = f.canal ? canal.get(normalizarNombre(f.canal)) : undefined;
    if (f.canal && !cid) { problemas.push(`Línea ${f.linea}: el canal «${f.canal}» no existe`); continue; }
    insertar.push({
      restaurant_id: rid, sale_date: f.fecha, menu_item_id: pid, channel_id: cid ?? null,
      quantity: f.cantidad, gross_amount: f.importe, source: "csv", import_key: f.clave,
    });
  }
  // nada a medias: si hay problemas, no se importa ninguna fila
  if (problemas.length) {
    return fallo(`No se ha importado nada: corrige ${problemas.length} ${problemas.length === 1 ? "línea" : "líneas"}.`,
      Object.fromEntries(problemas.slice(0, 15).map((p, i) => [String(i), p])));
  }
  let nuevas = 0;
  for (let i = 0; i < insertar.length; i += 500) {
    const { data, error } = await sb.from("sales").upsert(insertar.slice(i, i + 500), { onConflict: "restaurant_id,import_key", ignoreDuplicates: true }).select("id");
    if (error) return errorBD(error);
    nuevas += data?.length ?? 0;
  }
  revalidatePath(`/panel/${rid}/ventas`);
  return { ok: true, mensaje: `${nuevas} ventas importadas${insertar.length - nuevas ? `, ${insertar.length - nuevas} ya estaban (no se duplican)` : ""}.`, t: t() };
}

export async function borrarVenta(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("sales").delete().eq("id", String(form.get("id"))).eq("restaurant_id", rid);
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/ventas`);
  return { ok: true, mensaje: "Venta borrada.", t: t() };
}
