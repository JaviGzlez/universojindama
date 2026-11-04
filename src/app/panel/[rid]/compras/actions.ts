"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { calcularFactura, type LineaFactura } from "@/lib/compras";
import { getRestaurante } from "@/lib/contexto";
import { dec } from "@/lib/engine/decimal";
import { cargarIngredientes } from "@/lib/datos";
import { recalcularDependientes } from "@/lib/recetas";

const t = () => Date.now();
const fallo = (mensaje: string, errores?: Record<string, string>): ResultadoAccion => ({ ok: false, mensaje, errores, t: t() });
function errorBD(e: { message: string; code?: string }) {
  if (/row-level security/.test(e.message) || e.code === "42501") return fallo("No tienes permiso para gestionar compras en este restaurante.");
  if (e.code === "23505") return fallo(/purchase_invoices/.test(e.message) ? "Ya existe una factura de ese proveedor con ese número (posible duplicado)." : "Ya existe un registro con ese nombre.");
  return fallo(e.message);
}
const leer = <T extends z.ZodTypeAny>(s: T, f: FormData) => s.safeParse(Object.fromEntries(f));
const primer = (e: z.ZodError) => fallo(`Revisa los datos: ${e.issues[0]?.message}`);

const decimal = (min = 0, msg = "Número no válido") =>
  z.string().trim().refine((v) => dec(v) !== null && dec(v)!.greaterThanOrEqualTo(min), msg).transform((v) => dec(v)!.toString());
const decimalPos = (msg = "Debe ser mayor que 0") =>
  z.string().trim().refine((v) => dec(v) !== null && dec(v)!.greaterThan(0), msg).transform((v) => dec(v)!.toString());
const opcional = z.string().trim().max(300).optional().transform((v) => v || null);

// ---------------------------------------------------------------- proveedores
const Proveedor = z.object({
  rid: z.string().uuid(), name: z.string().trim().min(1, "Escribe el nombre").max(120),
  tax_id: opcional, contact: opcional, phone: opcional, email: opcional, notes: opcional,
});

export async function crearProveedor(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = leer(Proveedor, form);
  if (!p.success) return primer(p.error);
  const { rid, ...d } = p.data;
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("suppliers").insert({ ...d, restaurant_id: rid });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/compras/proveedores`);
  return { ok: true, mensaje: `Proveedor «${d.name}» guardado.`, t: t() };
}

const Producto = z.object({
  rid: z.string().uuid(), supplier_id: z.string().uuid("Elige proveedor"), ingredient_id: z.string().uuid("Elige materia prima"),
  description: z.string().trim().min(1, "Describe el formato").max(120), reference: opcional, brand: opcional,
  pack_quantity: decimalPos("La cantidad por envase debe ser mayor que 0"), pack_unit: z.enum(["g", "kg", "ml", "l", "unit"]),
  last_price: z.string().trim().optional().transform((v) => (v ? dec(v)?.toString() ?? null : null)),
});

export async function crearProducto(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = leer(Producto, form);
  if (!p.success) return primer(p.error);
  const { rid, ...d } = p.data;
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("supplier_products").insert({ ...d, restaurant_id: rid, last_price_date: d.last_price ? new Date().toISOString().slice(0, 10) : null });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/compras/proveedores`);
  return { ok: true, mensaje: `Producto «${d.description}» guardado.`, t: t() };
}

// ------------------------------------------------------------------- facturas
const Factura = z.object({
  rid: z.string().uuid(), supplier_id: z.string().uuid("Elige proveedor"),
  number: z.string().trim().min(1, "Escribe el número de factura").max(60),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
});

export async function crearFactura(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = leer(Factura, form);
  if (!p.success) return primer(p.error);
  const { rid, ...d } = p.data;
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { data, error } = await r.ctx.supabase.from("purchase_invoices").insert({ ...d, restaurant_id: rid }).select("id").single();
  if (error) return errorBD(error);
  redirect(`/panel/${rid}/compras/${data.id}`);
}

const Cabecera = z.object({
  rid: z.string().uuid(), id: z.string().uuid(), version: z.coerce.number().int(),
  number: z.string().trim().min(1).max(60), invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  discount_total: decimal(), shipping: decimal(),
  total: z.string().trim().optional().transform((v) => (v ? dec(v)?.toString() ?? null : null)),
  notes: opcional,
});

export async function guardarCabecera(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = leer(Cabecera, form);
  if (!p.success) return primer(p.error);
  const { rid, id, version, ...d } = p.data;
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { data, error } = await r.ctx.supabase.from("purchase_invoices").update(d).eq("id", id).eq("version", version).select("id");
  if (error) return errorBD(error);
  if (!data?.length) return fallo("La factura ha cambiado o ya no se puede editar. Recarga la página.");
  revalidatePath(`/panel/${rid}/compras/${id}`);
  return { ok: true, mensaje: "Cabecera guardada.", t: t() };
}

const Linea = z.object({
  rid: z.string().uuid(), invoice_id: z.string().uuid(),
  supplier_product_id: z.string().optional().transform((v) => v || null),
  ingredient_id: z.string().optional().transform((v) => v || null),
  description: z.string().trim().max(160).optional(),
  packs: decimalPos("Indica cuántos envases"), pack_quantity: z.string().optional(), pack_unit: z.string().optional(),
  pack_price: decimal(0, "Precio no válido"), discount_pct: z.string().optional().transform((v) => (v ? dec(v)?.toString() ?? "0" : "0")),
  tax_pct: z.string().optional().transform((v) => (v ? dec(v)?.div(100).toString() ?? "0" : "0")),
});

export async function anadirLinea(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const p = leer(Linea, form);
  if (!p.success) return primer(p.error);
  const d = p.data;
  const r = await getRestaurante(d.rid);
  if (!r) return fallo("Sin acceso.");
  const sb = r.ctx.supabase;
  let ingredient_id = d.ingredient_id;
  let description = d.description ?? "";
  let pack_quantity = d.pack_quantity ? dec(d.pack_quantity)?.toString() : undefined;
  let pack_unit = d.pack_unit;
  if (d.supplier_product_id) {
    const { data: prod } = await sb.from("supplier_products").select("ingredient_id, description, brand, pack_quantity, pack_unit").eq("id", d.supplier_product_id).single();
    if (!prod) return fallo("Producto no encontrado.");
    ingredient_id = prod.ingredient_id;
    description = description || [prod.description, prod.brand].filter(Boolean).join(" · ");
    pack_quantity = String(prod.pack_quantity);
    pack_unit = prod.pack_unit;
  }
  if (!pack_quantity || Number(pack_quantity) <= 0 || !pack_unit) return fallo("Indica el contenido de cada envase o elige un producto del proveedor.");
  if (!description) return fallo("Describe la línea.");
  const { count } = await sb.from("purchase_lines").select("id", { count: "exact", head: true }).eq("invoice_id", d.invoice_id);
  const { error } = await sb.from("purchase_lines").insert({
    restaurant_id: d.rid, invoice_id: d.invoice_id, position: count ?? 0,
    supplier_product_id: d.supplier_product_id, ingredient_id, description,
    packs: d.packs, pack_quantity, pack_unit, pack_price: d.pack_price, discount_pct: d.discount_pct, tax_rate: d.tax_pct,
  });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${d.rid}/compras/${d.invoice_id}`);
  return { ok: true, mensaje: "Línea añadida.", t: t() };
}

export async function quitarLinea(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.from("purchase_lines").delete().eq("id", String(form.get("id")));
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/compras/${String(form.get("invoice_id"))}`);
  return { ok: true, mensaje: "Línea quitada.", t: t() };
}

export async function validarFactura(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const id = String(form.get("id"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const sb = r.ctx.supabase;
  const [{ data: inv }, { data: lineas }, ings] = await Promise.all([
    sb.from("purchase_invoices").select("version, discount_total, shipping, status").eq("id", id).single(),
    sb.from("purchase_lines").select("id, ingredient_id, description, packs, pack_quantity, pack_unit, pack_price, discount_pct, tax_rate").eq("invoice_id", id).order("position"),
    cargarIngredientes(sb, rid, r.restaurante.organization_id),
  ]);
  if (!inv) return fallo("Factura no encontrada.");
  const refs = Object.fromEntries(ings.map((i) => [i.id, {
    id: i.id, name: i.name, baseUnit: i.base_unit, yieldRatio: i.yield_ratio,
    densityGPerMl: i.density_g_per_ml, unitWeightG: i.unit_weight_g, unitVolumeMl: i.unit_volume_ml, pricePerBaseUnit: null,
  }]));
  const calc = calcularFactura((lineas ?? []) as unknown as LineaFactura[], { discount_total: String(inv.discount_total), shipping: String(inv.shipping) }, refs);
  if (!calc.ok) return fallo("No se puede validar todavía.", Object.fromEntries(calc.errores.map((e, i) => [String(i), e])));
  const { data: upd, error: e1 } = await sb.from("purchase_invoices").update({ tax_total: calc.impuestos })
    .eq("id", id).eq("version", inv.version).in("status", ["draft", "review"]).select("version");
  if (e1) return errorBD(e1);
  if (!upd?.length) return fallo("La factura ha cambiado mientras la revisabas. Recarga la página.");
  const { error } = await sb.rpc("validate_purchase_invoice", { p_invoice: id, p_version: upd[0].version, p_lines: calc.lineas });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/compras/${id}`);
  return { ok: true, mensaje: "Factura validada. Revisa los precios por unidad y regístrala para aplicarlos.", t: t() };
}

export async function registrarFactura(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const id = String(form.get("id"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const sb = r.ctx.supabase;
  const { data, error } = await sb.rpc("post_purchase_invoice", { p_invoice: id });
  if (error) return errorBD(error);
  const ingredientes = ((data as { ingredients?: string[] })?.ingredients ?? []).filter(Boolean);
  const rc = await recalcularDependientes(sb, rid, r.restaurante.organization_id, [...new Set(ingredientes)]);
  revalidatePath(`/panel/${rid}/compras`);
  revalidatePath(`/panel/${rid}/compras/${id}`);
  revalidatePath(`/panel/${rid}/ingredientes`);
  return {
    ok: true,
    mensaje: `Factura registrada: precios e inventario actualizados.${rc.recalculadas ? ` ${rc.recalculadas} recetas recalculadas${rc.avisos ? `, ${rc.avisos} con aviso` : ""}.` : ""}`,
    t: t(),
  };
}

export async function reabrirFactura(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const id = String(form.get("id"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { error } = await r.ctx.supabase.rpc("reopen_purchase_invoice", { p_invoice: id });
  if (error) return errorBD(error);
  revalidatePath(`/panel/${rid}/compras/${id}`);
  return { ok: true, mensaje: "Factura reabierta para corregirla.", t: t() };
}

export async function borrarFactura(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const rid = String(form.get("rid"));
  const id = String(form.get("id"));
  const r = await getRestaurante(rid);
  if (!r) return fallo("Sin acceso.");
  const { data, error } = await r.ctx.supabase.from("purchase_invoices").delete().eq("id", id).in("status", ["draft", "review"]).select("id");
  if (error) return errorBD(error);
  if (!data?.length) return fallo("Solo se pueden borrar facturas sin validar.");
  revalidatePath(`/panel/${rid}/compras`);
  redirect(`/panel/${rid}/compras`);
}
