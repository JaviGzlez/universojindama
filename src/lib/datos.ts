import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface IngredienteFila {
  id: string;
  restaurant_id: string | null;
  name: string;
  category: string | null;
  base_unit: "g" | "ml" | "unit";
  yield_ratio: string;
  density_g_per_ml: string | null;
  unit_weight_g: string | null;
  unit_volume_ml: string | null;
  allergens: string[];
  version: number;
  precio: { price_per_base_unit: string; valid_from: string; quality: "measured" | "manufacturer" | "estimated" } | null;
}

export interface TarifaFila {
  id: string; name: string; source: "electricity" | "gas" | "water"; unit: string; price_per_unit: string;
  includes_taxes: boolean; valid_from: string; valid_to: string | null; version: number;
}

export interface EquipoFila {
  id: string; name: string; energy_source: "electricity" | "gas" | "water"; nominal_power_w: string | null;
  power_quality: "measured" | "manufacturer" | "estimated"; measured_consumption_per_hour: string | null;
  duty_factor: string; duty_factor_quality: "measured" | "manufacturer" | "estimated"; preheat_minutes: string;
  batch_capacity: string | null; energy_tariff_id: string | null; version: number;
}

export interface PerfilFila {
  id: string; name: string; period_label: string; period_cost: string; productive_hours: string;
  cost_per_hour: string; includes: string | null; version: number;
}

export interface ImpuestoFila {
  id: string; name: string; kind: "purchase" | "sale"; rate: string; recoverable: boolean; valid_from: string; version: number;
}

export interface ConsumibleFila {
  id: string; name: string; imputation_unit: "portion" | "batch" | "minute" | "order" | "percent"; amount: string; rule: string | null; version: number;
}

const hoy = () => new Date().toISOString().slice(0, 10);

export async function cargarIngredientes(sb: SupabaseClient, rid: string, orgId: string): Promise<IngredienteFila[]> {
  const [{ data: ings }, { data: precios }] = await Promise.all([
    sb.from("ingredients")
      .select("id, restaurant_id, name, category, base_unit, yield_ratio, density_g_per_ml, unit_weight_g, unit_volume_ml, allergens, version")
      .eq("organization_id", orgId)
      .or(`restaurant_id.eq.${rid},restaurant_id.is.null`)
      .eq("status", "active")
      .order("name"),
    sb.from("current_ingredient_prices").select("ingredient_id, price_per_base_unit, valid_from, quality").eq("restaurant_id", rid),
  ]);
  const mapa = new Map((precios ?? []).map((p) => [p.ingredient_id as string, p]));
  return (ings ?? []).map((i) => {
    const p = mapa.get(i.id);
    return { ...i, precio: p ? { price_per_base_unit: String(p.price_per_base_unit), valid_from: p.valid_from, quality: p.quality } : null } as IngredienteFila;
  });
}

export async function cargarTarifas(sb: SupabaseClient, rid: string): Promise<TarifaFila[]> {
  const { data } = await sb.from("energy_tariffs")
    .select("id, name, source, unit, price_per_unit, includes_taxes, valid_from, valid_to, version")
    .eq("restaurant_id", rid).eq("status", "active").order("valid_from", { ascending: false });
  return (data ?? []) as TarifaFila[];
}

/** Tarifas vigentes hoy: valid_from ≤ hoy y (valid_to nulo o ≥ hoy) */
export function tarifasVigentes(t: TarifaFila[], fecha = hoy()) {
  return t.filter((x) => x.valid_from <= fecha && (!x.valid_to || x.valid_to >= fecha));
}

export async function cargarEquipos(sb: SupabaseClient, rid: string): Promise<EquipoFila[]> {
  const { data } = await sb.from("equipment")
    .select("id, name, energy_source, nominal_power_w, power_quality, measured_consumption_per_hour, duty_factor, duty_factor_quality, preheat_minutes, batch_capacity, energy_tariff_id, version")
    .eq("restaurant_id", rid).eq("status", "active").order("name");
  return (data ?? []) as EquipoFila[];
}

export async function cargarPerfiles(sb: SupabaseClient, rid: string): Promise<PerfilFila[]> {
  const { data } = await sb.from("labor_profiles")
    .select("id, name, period_label, period_cost, productive_hours, cost_per_hour, includes, version")
    .eq("restaurant_id", rid).eq("status", "active").order("name");
  return (data ?? []) as PerfilFila[];
}

export async function cargarImpuestos(sb: SupabaseClient, rid: string): Promise<ImpuestoFila[]> {
  const { data } = await sb.from("tax_rates")
    .select("id, name, kind, rate, recoverable, valid_from, version")
    .eq("restaurant_id", rid).eq("status", "active").lte("valid_from", hoy()).order("valid_from", { ascending: false });
  return (data ?? []) as ImpuestoFila[];
}

export async function cargarConsumibles(sb: SupabaseClient, rid: string): Promise<ConsumibleFila[]> {
  const { data } = await sb.from("consumables")
    .select("id, name, imputation_unit, amount, rule, version")
    .eq("restaurant_id", rid).eq("status", "active").order("name");
  return (data ?? []) as ConsumibleFila[];
}

export async function cargarAjustes(sb: SupabaseClient, rid: string) {
  const { data } = await sb.from("restaurant_settings")
    .select("price_policy, money_decimals, version, targets, alert_thresholds")
    .eq("restaurant_id", rid).single();
  return data as {
    price_policy: "last_validated" | "weighted_average"; money_decimals: number; version: number;
    targets: { planned_portions_month?: number | null; target_food_cost_pct?: number | null } | null;
    alert_thresholds: { cost_change_pct?: number } | null;
  } | null;
}

