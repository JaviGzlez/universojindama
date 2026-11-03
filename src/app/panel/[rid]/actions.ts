"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { D, dec } from "@/lib/engine/decimal";
import { toBaseUnit } from "@/lib/engine/units";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------- utilidades
const texto = (max = 200) => z.string().trim().min(1, "Campo obligatorio").max(max);
const textoOpcional = (max = 500) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const decimal = (msg: string, opts: { min?: number; max?: number; gt?: number } = {}) =>
  z.string().trim().transform((v, ctx) => {
    const d = dec(v);
    const fuera =
      d === null ||
      (opts.min !== undefined && d.lessThan(opts.min)) ||
      (opts.gt !== undefined && d.lessThanOrEqualTo(opts.gt)) ||
      (opts.max !== undefined && d.greaterThan(opts.max));
    if (fuera) {
      ctx.addIssue({ code: "custom", message: msg });
      return z.NEVER;
    }
    return d!.toString();
  });
const decimalOpcional = (msg: string, opts: { gt?: number; min?: number; max?: number } = {}) =>
  z.string().trim().optional().transform((v, ctx) => {
    if (!v) return null;
    const d = dec(v);
    if (d === null || (opts.gt !== undefined && d.lessThanOrEqualTo(opts.gt)) || (opts.min !== undefined && d.lessThan(opts.min)) || (opts.max !== undefined && d.greaterThan(opts.max))) {
      ctx.addIssue({ code: "custom", message: msg });
      return z.NEVER;
    }
    return d.toString();
  });
const uuid = z.string().uuid("Identificador no válido");

function leer<T extends z.ZodTypeAny>(schema: T, form: FormData): { ok: true; data: z.infer<T> } | { ok: false; res: ResultadoAccion } {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (parsed.success) return { ok: true, data: parsed.data };
  const errores: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const k = issue.path.join(".") || "form";
    errores[k] ??= `${ETIQUETAS[k] ?? k}: ${issue.message}`;
  }
  return { ok: false, res: { ok: false, mensaje: "Revisa los campos marcados.", errores, t: Date.now() } };
}

const ETIQUETAS: Record<string, string> = {
  name: "Nombre", base_unit: "Unidad base", yield_pct: "Rendimiento", density: "Densidad", unit_weight_g: "Peso por unidad",
  unit_volume_ml: "Volumen por unidad", importe: "Precio", cantidad: "Cantidad", unidad: "Unidad", nominal_power_w: "Potencia",
  duty_pct: "Factor de funcionamiento", preheat_minutes: "Precalentamiento", batch_capacity: "Capacidad", period_cost: "Coste del periodo",
  productive_hours: "Horas productivas", price_per_unit: "Precio", rate_pct: "Tipo", valid_from: "Vigente desde", amount: "Importe",
  money_decimals: "Decimales", timezone: "Zona horaria",
};

function errorBD(error: { message: string; code?: string }): ResultadoAccion {
  let mensaje = "No se ha podido guardar. Inténtalo de nuevo.";
  if (/row-level security/i.test(error.message) || error.code === "42501") mensaje = "No tienes permiso para esta acción en este restaurante.";
  else if (error.code === "23514") mensaje = "Algún valor está fuera del rango permitido.";
  else if (error.code === "23505") mensaje = "Ya existe un registro igual.";
  else if (error.message) mensaje = error.message;
  return { ok: false, mensaje, t: Date.now() };
}

const hecho = (rid: string, mensaje: string, sub = ""): ResultadoAccion => {
  revalidatePath(`/panel/${rid}${sub}`);
  revalidatePath(`/panel/${rid}`);
  return { ok: true, mensaje, t: Date.now() };
};

// -------------------------------------------------------------- ingredientes
const Ingrediente = z.object({
  restaurant_id: uuid,
  scope: z.enum(["local", "shared"]).default("local"),
  name: texto(),
  category: textoOpcional(100),
  base_unit: z.enum(["g", "ml", "unit"]),
  yield_pct: decimal("debe estar entre 0 (excluido) y 100 %", { gt: 0, max: 100 }),
  density: decimalOpcional("debe ser mayor que 0", { gt: 0 }),
  unit_weight_g: decimalOpcional("debe ser mayor que 0", { gt: 0 }),
  unit_volume_ml: decimalOpcional("debe ser mayor que 0", { gt: 0 }),
  allergens: textoOpcional(300),
  source: textoOpcional(200),
});

export async function crearIngrediente(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Ingrediente, form);
  if (!r.ok) return r.res;
  const d = r.data;
  const supabase = await createClient();
  const { data: rest } = await supabase.from("restaurants").select("organization_id").eq("id", d.restaurant_id).single();
  if (!rest) return { ok: false, mensaje: "Restaurante no encontrado.", t: Date.now() };
  const { error } = await supabase.from("ingredients").insert({
    organization_id: rest.organization_id,
    restaurant_id: d.scope === "shared" ? null : d.restaurant_id,
    name: d.name,
    category: d.category,
    base_unit: d.base_unit,
    yield_ratio: new D(d.yield_pct).div(100).toString(),
    density_g_per_ml: d.density,
    unit_weight_g: d.unit_weight_g,
    unit_volume_ml: d.unit_volume_ml,
    allergens: d.allergens ? d.allergens.split(",").map((a) => a.trim()).filter(Boolean) : [],
    source: d.source,
  });
  if (error) return errorBD(error);
  return hecho(d.restaurant_id, `«${d.name}» guardado en el servidor.`, "/ingredientes");
}

const Precio = z.object({
  restaurant_id: uuid,
  ingredient_id: uuid,
  importe: decimal("debe ser un importe válido (0 o más)", { min: 0 }),
  cantidad: decimal("debe ser mayor que 0", { gt: 0 }),
  unidad: z.enum(["g", "kg", "ml", "l", "unit"]),
  notes: textoOpcional(300),
});

/** Registra un precio de compra (sin impuestos recuperables) y lo convierte a unidad base. */
export async function registrarPrecio(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Precio, form);
  if (!r.ok) return r.res;
  const d = r.data;
  const supabase = await createClient();
  const { data: ing, error: e1 } = await supabase
    .from("ingredients")
    .select("id, name, base_unit, yield_ratio, density_g_per_ml, unit_weight_g, unit_volume_ml")
    .eq("id", d.ingredient_id)
    .single();
  if (e1 || !ing) return { ok: false, mensaje: "Ingrediente no encontrado.", t: Date.now() };

  const conv = toBaseUnit(new D(d.cantidad), d.unidad, {
    id: ing.id, name: ing.name, baseUnit: ing.base_unit, yieldRatio: ing.yield_ratio,
    densityGPerMl: ing.density_g_per_ml, unitWeightG: ing.unit_weight_g, unitVolumeMl: ing.unit_volume_ml,
    pricePerBaseUnit: null,
  });
  if (!conv.ok) return { ok: false, mensaje: conv.message, t: Date.now() };

  const { error } = await supabase.from("ingredient_prices").insert({
    restaurant_id: d.restaurant_id,
    ingredient_id: d.ingredient_id,
    price_per_base_unit: new D(d.importe).div(conv.value).toDecimalPlaces(8).toString(),
    source: "manual",
    notes: d.notes ?? `${d.importe} € por ${d.cantidad} ${d.unidad}`,
  });
  if (error) return errorBD(error);
  return hecho(d.restaurant_id, `Precio de «${ing.name}» registrado. El anterior queda en el histórico.`, "/ingredientes");
}

// ------------------------------------------------------------------- equipos
const Equipo = z.object({
  restaurant_id: uuid,
  name: texto(),
  energy_source: z.enum(["electricity", "gas", "water"]),
  nominal_power_w: decimalOpcional("debe ser 0 o más", { min: 0 }),
  power_quality: z.enum(["measured", "manufacturer", "estimated"]),
  duty_pct: decimal("debe estar entre 0 (excluido) y 100 %", { gt: 0, max: 100 }),
  duty_factor_quality: z.enum(["measured", "manufacturer", "estimated"]),
  preheat_minutes: decimal("debe ser 0 o más", { min: 0 }),
  batch_capacity: decimalOpcional("debe ser mayor que 0", { gt: 0 }),
  energy_tariff_id: z.string().optional().transform((v) => (v ? v : null)),
  notes: textoOpcional(),
});

export async function crearEquipo(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Equipo, form);
  if (!r.ok) return r.res;
  const { duty_pct, restaurant_id, ...d } = r.data;
  const supabase = await createClient();
  const { error } = await supabase.from("equipment").insert({
    ...d, restaurant_id, duty_factor: new D(duty_pct).div(100).toString(),
  });
  if (error) return errorBD(error);
  return hecho(restaurant_id, `Equipo «${d.name}» guardado en el servidor.`, "/equipos");
}

// ------------------------------------------------------------------ personal
const Perfil = z.object({
  restaurant_id: uuid,
  name: texto(),
  period_label: texto(40),
  period_cost: decimal("debe ser 0 o más", { min: 0 }),
  productive_hours: decimal("deben ser más de 0", { gt: 0 }),
  includes: textoOpcional(),
});

export async function crearPerfil(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Perfil, form);
  if (!r.ok) return r.res;
  const supabase = await createClient();
  const { error } = await supabase.from("labor_profiles").insert(r.data);
  if (error) return errorBD(error);
  return hecho(r.data.restaurant_id, `Perfil «${r.data.name}» guardado en el servidor.`, "/personal");
}

// ------------------------------------------------------- tarifas e impuestos
const Tarifa = z.object({
  restaurant_id: uuid,
  name: texto(),
  source: z.enum(["electricity", "gas", "water"]),
  unit: z.enum(["kWh", "m3", "l"]),
  price_per_unit: decimal("debe ser 0 o más", { min: 0 }),
  includes_taxes: z.string().optional().transform((v) => v === "on"),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha no válida"),
  notes: textoOpcional(),
});

export async function crearTarifa(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Tarifa, form);
  if (!r.ok) return r.res;
  if (r.data.source === "electricity" && r.data.unit !== "kWh") {
    return { ok: false, mensaje: "La electricidad se factura en kWh.", t: Date.now() };
  }
  if (r.data.source === "water" && r.data.unit === "kWh") {
    return { ok: false, mensaje: "El agua se mide en m³ o litros.", t: Date.now() };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("energy_tariffs").insert(r.data);
  if (error) return errorBD(error);
  return hecho(r.data.restaurant_id, `Tarifa «${r.data.name}» guardada en el servidor.`, "/ajustes");
}

const Impuesto = z.object({
  restaurant_id: uuid,
  name: texto(),
  kind: z.enum(["purchase", "sale"]),
  rate_pct: decimal("debe estar entre 0 y 99,99 %", { min: 0, max: 99.99 }),
  recoverable: z.string().optional().transform((v) => v === "on"),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha no válida"),
});

export async function crearImpuesto(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Impuesto, form);
  if (!r.ok) return r.res;
  const { rate_pct, ...d } = r.data;
  const supabase = await createClient();
  const { error } = await supabase.from("tax_rates").insert({ ...d, rate: new D(rate_pct).div(100).toString() });
  if (error) return errorBD(error);
  return hecho(d.restaurant_id, `Impuesto «${d.name}» guardado en el servidor.`, "/ajustes");
}

// --------------------------------------------------------------- consumibles
const Consumible = z.object({
  restaurant_id: uuid,
  name: texto(),
  imputation_unit: z.enum(["portion", "batch", "minute", "order", "percent"]),
  amount: decimal("debe ser 0 o más", { min: 0 }),
  rule: textoOpcional(),
});

export async function crearConsumible(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Consumible, form);
  if (!r.ok) return r.res;
  const supabase = await createClient();
  const { error } = await supabase.from("consumables").insert(r.data);
  if (error) return errorBD(error);
  return hecho(r.data.restaurant_id, `«${r.data.name}» guardado en el servidor.`, "/equipos");
}

// ------------------------------------------------------- ajustes generales
const Ajustes = z.object({
  restaurant_id: uuid,
  version: z.coerce.number().int(),
  price_policy: z.enum(["last_validated", "weighted_average"]),
  money_decimals: z.coerce.number().int().min(0).max(6),
});

export async function guardarAjustes(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Ajustes, form);
  if (!r.ok) return r.res;
  const d = r.data;
  const supabase = await createClient();
  // Control de concurrencia: solo se actualiza si nadie ha cambiado la versión leída.
  const { data, error } = await supabase
    .from("restaurant_settings")
    .update({ price_policy: d.price_policy, money_decimals: d.money_decimals })
    .eq("restaurant_id", d.restaurant_id)
    .eq("version", d.version)
    .select("version");
  if (error) return errorBD(error);
  if (!data || data.length === 0) {
    return { ok: false, mensaje: "Otra persona ha cambiado estos ajustes o no tienes permiso. Recarga la página.", t: Date.now() };
  }
  return hecho(d.restaurant_id, "Ajustes guardados en el servidor.", "/ajustes");
}

// ------------------------------------------------------------------ archivar
const TABLAS_ARCHIVABLES = ["ingredients", "equipment", "labor_profiles", "energy_tariffs", "tax_rates", "consumables"] as const;
const Archivar = z.object({
  restaurant_id: uuid,
  tabla: z.enum(TABLAS_ARCHIVABLES),
  id: uuid,
  version: z.coerce.number().int(),
  ruta: z.string().regex(/^\/[a-z]*$/),
});

/** Los catálogos referenciados no se borran: se archivan sin romper el histórico. */
export async function archivar(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const r = leer(Archivar, form);
  if (!r.ok) return r.res;
  const d = r.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(d.tabla)
    .update({ status: "archived" })
    .eq("id", d.id)
    .eq("version", d.version)
    .select("id");
  if (error) return errorBD(error);
  if (!data || data.length === 0) return { ok: false, mensaje: "No se ha podido archivar: recarga la página.", t: Date.now() };
  return hecho(d.restaurant_id, "Archivado.", d.ruta);
}
