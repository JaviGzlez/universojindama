"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { getRestaurante } from "@/lib/contexto";
import { cargarIngredientes } from "@/lib/datos";
import { dec } from "@/lib/engine/decimal";
import { toBaseUnit } from "@/lib/engine/units";

const t = () => Date.now();
const fallo = (m: string): ResultadoAccion => ({ ok: false, mensaje: m, t: t() });
const errorBD = (e: { message: string; code?: string }) =>
  fallo(/row-level security/.test(e.message) || e.code === "42501" ? "No tienes permiso para mover inventario en este restaurante." : e.message);

const SALIDAS = ["waste", "transfer_out", "production_out"];

const Movimiento = z.object({
  rid: z.string().uuid(), ingredient_id: z.string().uuid("Elige materia prima"),
  kind: z.enum(["waste", "adjustment_plus", "adjustment_minus", "transfer_in", "transfer_out", "production_in", "production_out"]),
  quantity: z.string().refine((v) => dec(v)?.greaterThan(0) ?? false, "Cantidad no válida"),
  unit: z.enum(["g", "kg", "ml", "l", "unit"]),
  occurred_at: z.string().optional(), notes: z.string().max(300).optional(),
});

export async function registrarMovimiento(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Movimiento.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos no válidos");
  const d = p.data;
  const r = await getRestaurante(d.rid);
  if (!r) return fallo("Sin acceso.");
  const ings = await cargarIngredientes(r.ctx.supabase, d.rid, r.restaurante.organization_id);
  const i = ings.find((x) => x.id === d.ingredient_id);
  if (!i) return fallo("Materia prima no encontrada.");
  const conv = toBaseUnit(dec(d.quantity)!, d.unit, {
    id: i.id, name: i.name, baseUnit: i.base_unit, yieldRatio: i.yield_ratio, densityGPerMl: i.density_g_per_ml,
    unitWeightG: i.unit_weight_g, unitVolumeMl: i.unit_volume_ml, pricePerBaseUnit: null,
  });
  if (!conv.ok) return fallo(conv.message);
  const kind = d.kind.startsWith("adjustment") ? "adjustment" : d.kind;
  const negativo = SALIDAS.includes(d.kind) || d.kind === "adjustment_minus";
  const { error } = await r.ctx.supabase.from("stock_movements").insert({
    restaurant_id: d.rid, ingredient_id: d.ingredient_id, kind,
    quantity: (negativo ? conv.value.negated() : conv.value).toString(),
    occurred_at: d.occurred_at ? new Date(d.occurred_at).toISOString() : new Date().toISOString(),
    unit_cost: i.precio?.price_per_base_unit ?? null, notes: d.notes || null,
  });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${d.rid}/inventario`);
  return { ok: true, mensaje: "Movimiento registrado.", t: t() };
}

export async function guardarRecuento(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const lineas: { ingredient_id: string; quantity: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("q_") || String(v).trim() === "") continue;
    const q = dec(String(v));
    if (!q || q.lessThan(0)) return fallo("Hay cantidades no válidas en el recuento.");
    lineas.push({ ingredient_id: k.slice(2), quantity: q.toString() });
  }
  if (lineas.length === 0) return fallo("Escribe al menos una cantidad.");
  const cuando = String(form.get("counted_at") || "");
  const sb = r.ctx.supabase;
  const { data: c, error } = await sb.from("stock_counts").insert({
    restaurant_id: rid, counted_at: cuando ? new Date(cuando).toISOString() : new Date().toISOString(), notes: String(form.get("notes") || "") || null,
  }).select("id").single();
  if (error) return errorBD(error);
  const { error: e2 } = await sb.from("stock_count_lines").insert(lineas.map((l) => ({ ...l, restaurant_id: rid, count_id: c.id })));
  if (e2) {
    await sb.from("stock_counts").delete().eq("id", c.id); // no dejar recuentos a medias
    return errorBD(e2);
  }
  revalidatePath(`/panel/${rid}/inventario`);
  return { ok: true, mensaje: `Recuento guardado (${lineas.length} materias primas).`, t: t() };
}
