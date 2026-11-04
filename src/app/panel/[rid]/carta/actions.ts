"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { getRestaurante } from "@/lib/contexto";
import { dec } from "@/lib/engine/decimal";

const t = () => Date.now();
const fallo = (m: string): ResultadoAccion => ({ ok: false, mensaje: m, t: t() });
const errorBD = (e: { message: string; code?: string }) =>
  fallo(/row-level security/.test(e.message) || e.code === "42501" ? "No tienes permiso para esta acción." : e.code === "23505" ? "Ya existe con ese nombre." : e.message);
const pct = (v: string | undefined) => (v && v.trim() ? dec(v)?.div(100).toString() ?? null : "0");
const num = (v: string | undefined, def = "0") => (v && v.trim() ? dec(v)?.toString() ?? null : def);

const Canal = z.object({
  rid: z.string().uuid(), name: z.string().trim().min(1, "Escribe el nombre").max(60),
  kind: z.enum(["dine_in", "takeaway", "own_delivery", "platform"]),
  commission_pct: z.string().optional(), commission_base: z.enum(["net", "gross"]),
  fixed_fee_per_order: z.string().optional(), portions_per_order: z.string().optional(), packaging_per_portion: z.string().optional(),
  notes: z.string().max(300).optional(),
});

export async function crearCanal(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Canal.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos no válidos");
  const d = p.data;
  const fila = {
    restaurant_id: d.rid, name: d.name, kind: d.kind, commission_base: d.commission_base,
    commission_pct: pct(d.commission_pct), fixed_fee_per_order: num(d.fixed_fee_per_order),
    portions_per_order: num(d.portions_per_order, "1"), packaging_per_portion: num(d.packaging_per_portion), notes: d.notes || null,
  };
  if (Object.values(fila).some((v) => v === null && v !== fila.notes)) return fallo("Revisa los números.");
  const r = await getRestaurante(d.rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("sales_channels").insert(fila);
  if (error) return errorBD(error);
  revalidatePath(`/panel/${d.rid}/carta`);
  return { ok: true, mensaje: `Canal «${d.name}» guardado.`, t: t() };
}

const Plato = z.object({
  rid: z.string().uuid(), name: z.string().trim().min(1, "Escribe el nombre").max(120),
  category: z.string().trim().max(60).optional(), recipe_id: z.string().optional(),
});

export async function crearPlato(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Plato.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos no válidos");
  const d = p.data;
  const r = await getRestaurante(d.rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("menu_items").insert({ restaurant_id: d.rid, name: d.name, category: d.category || null, recipe_id: d.recipe_id || null });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${d.rid}/carta`);
  return { ok: true, mensaje: `«${d.name}» añadido a la carta.`, t: t() };
}

const Precio = z.object({
  rid: z.string().uuid(), menu_item_id: z.string().uuid("Elige plato"), channel_id: z.string().uuid("Elige canal"),
  pvp: z.string().refine((v) => dec(v) !== null && dec(v)!.greaterThanOrEqualTo(0), "PVP no válido"),
  pvp_includes_tax: z.string().optional(), tax_pct: z.string().refine((v) => dec(v) !== null && dec(v)!.greaterThanOrEqualTo(0) && dec(v)!.lessThan(100), "IVA no válido"),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function fijarPrecio(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Precio.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos no válidos");
  const d = p.data;
  const r = await getRestaurante(d.rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("channel_prices").insert({
    restaurant_id: d.rid, menu_item_id: d.menu_item_id, channel_id: d.channel_id, pvp: dec(d.pvp)!.toString(),
    pvp_includes_tax: d.pvp_includes_tax !== "no", tax_rate: dec(d.tax_pct)!.div(100).toString(), valid_from: d.valid_from,
  });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${d.rid}/carta`);
  return { ok: true, mensaje: "Precio guardado. El anterior queda en el histórico.", t: t() };
}

export async function enlazarReceta(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const recipe = String(form.get("recipe_id") || "") || null;
  const { error } = await r.ctx.supabase.from("menu_items").update({ recipe_id: recipe }).eq("id", String(form.get("id")));
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/carta`);
  return { ok: true, mensaje: "Receta enlazada.", t: t() };
}
