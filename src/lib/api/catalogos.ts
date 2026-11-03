import "server-only";
import { z } from "zod";

const decimalStr = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^-?\d+(\.\d+)?$/.test(v), "Número decimal no válido");
const decimalOpt = decimalStr.nullable().optional();
const quality = z.enum(["measured", "manufacturer", "estimated"]);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Catálogos por restaurante expuestos en /api/v1/restaurants/{id}/<recurso>.
 * organization_id lo rellena la base de datos desde el restaurante.
 */
export const CATALOGOS = {
  ingredients: {
    tabla: "ingredients",
    columnas: "id, organization_id, restaurant_id, name, category, base_unit, yield_ratio, density_g_per_ml, unit_weight_g, unit_volume_ml, storage, allergens, source, status, created_at, updated_at, version",
    incluyeCompartidos: true,
    crear: z.object({
      name: z.string().trim().min(1).max(200),
      category: z.string().max(100).nullable().optional(),
      base_unit: z.enum(["g", "ml", "unit"]),
      yield_ratio: decimalStr.default("1"),
      density_g_per_ml: decimalOpt,
      unit_weight_g: decimalOpt,
      unit_volume_ml: decimalOpt,
      storage: z.string().max(200).nullable().optional(),
      allergens: z.array(z.string().max(60)).max(30).default([]),
      source: z.string().max(200).nullable().optional(),
      shared: z.boolean().default(false),
    }).strict(),
  },
  equipment: {
    tabla: "equipment",
    columnas: "id, restaurant_id, name, energy_source, nominal_power_w, power_quality, measured_consumption_per_hour, duty_factor, duty_factor_quality, preheat_minutes, batch_capacity, energy_tariff_id, notes, status, created_at, updated_at, version",
    incluyeCompartidos: false,
    crear: z.object({
      name: z.string().trim().min(1).max(200),
      energy_source: z.enum(["electricity", "gas", "water"]).default("electricity"),
      nominal_power_w: decimalOpt,
      power_quality: quality.default("manufacturer"),
      measured_consumption_per_hour: decimalOpt,
      duty_factor: decimalStr.default("1"),
      duty_factor_quality: quality.default("estimated"),
      preheat_minutes: decimalStr.default("0"),
      batch_capacity: decimalOpt,
      energy_tariff_id: z.string().uuid().nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
    }).strict(),
  },
  "labor-profiles": {
    tabla: "labor_profiles",
    columnas: "id, restaurant_id, name, period_label, period_cost, productive_hours, cost_per_hour, includes, status, created_at, updated_at, version",
    incluyeCompartidos: false,
    crear: z.object({
      name: z.string().trim().min(1).max(200),
      period_label: z.string().max(40).default("mensual"),
      period_cost: decimalStr,
      productive_hours: decimalStr,
      includes: z.string().max(500).nullable().optional(),
    }).strict(),
  },
  "energy-tariffs": {
    tabla: "energy_tariffs",
    columnas: "id, restaurant_id, name, source, unit, price_per_unit, includes_taxes, valid_from, valid_to, notes, status, created_at, updated_at, version",
    incluyeCompartidos: false,
    crear: z.object({
      name: z.string().trim().min(1).max(200),
      source: z.enum(["electricity", "gas", "water"]),
      unit: z.enum(["kWh", "m3", "l"]),
      price_per_unit: decimalStr,
      includes_taxes: z.boolean().default(false),
      valid_from: fecha.optional(),
      valid_to: fecha.nullable().optional(),
      notes: z.string().max(500).nullable().optional(),
    }).strict(),
  },
  "tax-rates": {
    tabla: "tax_rates",
    columnas: "id, restaurant_id, name, kind, rate, recoverable, valid_from, valid_to, status, created_at, updated_at, version",
    incluyeCompartidos: false,
    crear: z.object({
      name: z.string().trim().min(1).max(200),
      kind: z.enum(["purchase", "sale"]),
      rate: decimalStr,
      recoverable: z.boolean().default(true),
      valid_from: fecha.optional(),
      valid_to: fecha.nullable().optional(),
    }).strict(),
  },
  consumables: {
    tabla: "consumables",
    columnas: "id, restaurant_id, name, imputation_unit, amount, rule, status, created_at, updated_at, version",
    incluyeCompartidos: false,
    crear: z.object({
      name: z.string().trim().min(1).max(200),
      imputation_unit: z.enum(["portion", "batch", "minute", "order", "percent"]),
      amount: decimalStr,
      rule: z.string().max(500).nullable().optional(),
    }).strict(),
  },
} as const;

export type RecursoCatalogo = keyof typeof CATALOGOS;
export const esRecurso = (r: string): r is RecursoCatalogo => r in CATALOGOS;
