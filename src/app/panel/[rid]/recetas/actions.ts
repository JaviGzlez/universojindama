"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { getRestaurante } from "@/lib/contexto";
import { dec } from "@/lib/engine/decimal";
import { calcularVersion, cargarCatalogo, cargarVersion, guardarFotografia, recalcularRecetas, recetasQueUsan, type Receta } from "@/lib/recetas";

const t = () => Date.now();
const fallo = (mensaje: string): ResultadoAccion => ({ ok: false, mensaje, t: t() });
const errorBD = (e: { message: string; code?: string }) =>
  fallo(/row-level security|42501/.test(e.message + (e.code ?? "")) ? "No tienes permiso para cambiar recetas en este restaurante." : e.message);

async function receta(rid: string, id: string) {
  const r = await getRestaurante(rid);
  if (!r) return null;
  const { data } = await r.ctx.supabase.from("recipes")
    .select("id, restaurant_id, name, kind, category, active_version_id, status, version").eq("id", id).eq("restaurant_id", rid).maybeSingle();
  return data ? { ...r, receta: data as Receta } : null;
}

const Nueva = z.object({
  rid: z.string().uuid(),
  name: z.string().trim().min(1, "Escribe un nombre").max(120),
  kind: z.enum(["dish", "preparation"]),
  category: z.string().trim().max(60).optional(),
});

export async function crearReceta(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Nueva.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo(p.error.issues[0]?.message ?? "Datos no válidos");
  const r = await getRestaurante(p.data.rid);
  if (!r) return fallo("Sin acceso.");
  const sb = r.ctx.supabase;
  const { data, error } = await sb.from("recipes")
    .insert({ restaurant_id: p.data.rid, name: p.data.name, kind: p.data.kind, category: p.data.category || null }).select("id").single();
  if (error) return errorBD(error);
  const { error: e2 } = await sb.rpc("new_recipe_version", { p_recipe: data.id });
  if (e2) return errorBD(e2);
  redirect(`/panel/${p.data.rid}/recetas/${data.id}`);
}

const num = (opcional = false) => z.string().trim().refine((v) => (opcional && v === "") || (dec(v) !== null && dec(v)!.greaterThanOrEqualTo(0)), "Número no válido")
  .transform((v) => (v === "" ? "" : dec(v)!.toString()));

const Borrador = z.object({
  portions: num(true), yield_quantity: num(true), yield_unit: z.enum(["g", "ml", "unit", ""]),
  labor_is_variable: z.boolean(), use_overheads: z.boolean(),
  steps: z.string().max(8000), notes: z.string().max(2000),
  ingredientes: z.array(z.object({
    ingredient_id: z.string().uuid().nullable(), sub_recipe_id: z.string().uuid().nullable(),
    quantity: num(), unit: z.enum(["g", "kg", "ml", "l", "unit"]), quantity_type: z.enum(["net", "gross"]),
  }).refine((l) => (l.ingredient_id === null) !== (l.sub_recipe_id === null), "Cada línea lleva una materia prima o una elaboración")).max(150),
  equipos: z.array(z.object({
    equipment_id: z.string().uuid(), minutes: num(), usage_share: num(), preheat_share: num(), measured_consumption: num(true).nullable(),
  })).max(30),
  personal: z.array(z.object({ labor_profile_id: z.string().uuid(), active_minutes: num() })).max(30),
  consumibles: z.array(z.object({ consumable_id: z.string().uuid() })).max(30),
});

export async function guardarBorrador(rid: string, recipeId: string, versionId: string, esperada: number, datos: unknown): Promise<ResultadoAccion & { version?: number }> {
  const r = await receta(rid, recipeId);
  if (!r) return fallo("Sin acceso.");
  const p = Borrador.safeParse(datos);
  if (!p.success) return fallo(`Revisa la receta: ${p.error.issues[0]?.message ?? "datos no válidos"}.`);
  const d = p.data;
  for (const e of d.equipos) {
    if (Number(e.usage_share) > 1 || Number(e.preheat_share) > 1) return fallo("Los porcentajes de uso no pueden pasar del 100 %.");
  }
  const { data, error } = await r.ctx.supabase.rpc("save_recipe_draft", {
    p_version: versionId, p_expected: esperada,
    p_data: { ...d, equipos: d.equipos.map((e) => ({ ...e, measured_consumption: e.measured_consumption || null })) },
  });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/recetas/${recipeId}`);
  return { ok: true, mensaje: "Borrador guardado en el servidor.", version: data as number, t: t() };
}

export async function activarVersion(rid: string, recipeId: string, versionId: string): Promise<ResultadoAccion> {
  const r = await receta(rid, recipeId);
  if (!r) return fallo("Sin acceso.");
  const sb = r.ctx.supabase;
  const { error } = await sb.rpc("activate_recipe_version", { p_version: versionId });
  if (error) return errorBD(error);
  // fotografía del coste al activar
  const { cat } = await cargarCatalogo(sb, rid, r.restaurante.organization_id);
  const v = await cargarVersion(sb, versionId);
  if (v) await guardarFotografia(sb, { ...r.receta, active_version_id: versionId }, versionId, calcularVersion(v, r.receta, cat).result, "activation");
  // si es una elaboración, los platos que la usan cambian de coste
  if (r.receta.kind === "preparation") {
    const deps = await recetasQueUsan(sb, recipeId);
    await recalcularRecetas(sb, rid, r.restaurante.organization_id, deps, "recalculation");
  }
  revalidatePath(`/panel/${rid}/recetas`);
  revalidatePath(`/panel/${rid}/recetas/${recipeId}`);
  return { ok: true, mensaje: "Versión activada. La anterior queda en el histórico.", t: t() };
}

export async function nuevaVersion(rid: string, recipeId: string): Promise<ResultadoAccion> {
  const r = await receta(rid, recipeId);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.rpc("new_recipe_version", { p_recipe: recipeId });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/recetas/${recipeId}`);
  return { ok: true, mensaje: "Borrador creado a partir de la versión activa.", t: t() };
}

export async function descartarBorrador(rid: string, recipeId: string, versionId: string): Promise<ResultadoAccion> {
  const r = await receta(rid, recipeId);
  if (!r) return fallo("Sin acceso.");
  if (!r.receta.active_version_id) return fallo("Es la única versión: archiva la receta si no la necesitas.");
  const { data, error } = await r.ctx.supabase.from("recipe_versions").delete().eq("id", versionId).eq("status", "draft").select("id");
  if (error) return errorBD(error);
  if (!data?.length) return fallo("No se ha podido descartar.");
  revalidatePath(`/panel/${rid}/recetas/${recipeId}`);
  return { ok: true, mensaje: "Borrador descartado.", t: t() };
}

export async function guardarCalculo(rid: string, recipeId: string): Promise<ResultadoAccion> {
  const r = await receta(rid, recipeId);
  if (!r?.receta.active_version_id) return fallo("La receta no tiene versión activa.");
  const sb = r.ctx.supabase;
  const { cat } = await cargarCatalogo(sb, rid, r.restaurante.organization_id);
  const v = await cargarVersion(sb, r.receta.active_version_id);
  if (!v) return fallo("Versión no encontrada.");
  const { error } = await guardarFotografia(sb, r.receta, v.id, calcularVersion(v, r.receta, cat).result, "manual");
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/recetas/${recipeId}`);
  return { ok: true, mensaje: "Cálculo guardado en el histórico.", t: t() };
}

const Datos = z.object({
  rid: z.string().uuid(), id: z.string().uuid(), version: z.coerce.number().int(),
  name: z.string().trim().min(1).max(120), category: z.string().trim().max(60),
});

export async function renombrarReceta(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = Datos.safeParse(Object.fromEntries(form));
  if (!p.success) return fallo("Escribe un nombre.");
  const r = await receta(p.data.rid, p.data.id);
  if (!r) return fallo("Sin acceso.");
  const { data, error } = await r.ctx.supabase.from("recipes").update({ name: p.data.name, category: p.data.category || null })
    .eq("id", p.data.id).eq("version", p.data.version).select("id");
  if (error) return errorBD(error);
  if (!data?.length) return fallo("Otra persona ha cambiado la receta. Recarga la página.");
  revalidatePath(`/panel/${p.data.rid}/recetas`);
  revalidatePath(`/panel/${p.data.rid}/recetas/${p.data.id}`);
  return { ok: true, mensaje: "Guardado.", t: t() };
}

export async function archivarReceta(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const id = String(form.get("id"));
  const r = await receta(rid, id);
  if (!r) return fallo("Sin acceso.");
  const usada = await recetasQueUsan(r.ctx.supabase, id);
  if (usada.length) return fallo("Esta elaboración se usa en otras recetas activas: quítala de ellas antes de archivarla.");
  const { error } = await r.ctx.supabase.from("recipes").update({ status: "archived" }).eq("id", id);
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/recetas`);
  redirect(`/panel/${rid}/recetas`);
}
