import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENGINE_VERSION, type CalculationResult, type ChannelInput, type QuantityUnit } from "@/lib/engine";
import { cargarConsumibles, cargarEquipos, cargarIngredientes, cargarPerfiles, cargarTarifas, tarifasVigentes } from "@/lib/datos";
import { gastosGeneralesPorRacion } from "@/lib/economia";
import { alergenosDe, calcularDesdeCatalogo, type CatalogoPlano, type ResultadoCalculo, type VersionEditable } from "@/lib/recetas-entrada";

export interface Receta {
  id: string;
  restaurant_id: string;
  name: string;
  kind: "preparation" | "dish";
  category: string | null;
  active_version_id: string | null;
  status: "active" | "archived";
  version: number;
}

export interface Version {
  id: string;
  recipe_id: string;
  number: number;
  status: "draft" | "active" | "superseded";
  yield_quantity: string | null;
  yield_unit: "g" | "ml" | "unit" | null;
  portions: string | null;
  labor_is_variable: boolean;
  use_overheads: boolean;
  steps: string | null;
  notes: string | null;
  version: number;
  created_at: string;
  activated_at: string | null;
  ingredientes: { id: string; position: number; ingredient_id: string | null; sub_recipe_id: string | null; quantity: string; unit: QuantityUnit; quantity_type: "net" | "gross" }[];
  equipos: { id: string; equipment_id: string; minutes: string; usage_share: string; preheat_share: string; measured_consumption: string | null }[];
  personal: { id: string; labor_profile_id: string; active_minutes: string }[];
  consumibles: { id: string; consumable_id: string }[];
  prep_minutes: string | null;
  cook_minutes: string | null;
  rest_minutes: string | null;
  shelf_life_hours: string | null;
  storage: string | null;
  serving: string | null;
  portion_size: string | null;
  extra_allergens: string[];
  pasos: { id: string; position: number; title: string | null; description: string; minutes: string | null; temperature_c: string | null; equipment_id: string | null; is_critical: boolean }[];
}

const COLS_VERSION =
  "id, recipe_id, number, status, yield_quantity, yield_unit, portions, labor_is_variable, use_overheads, steps, notes, version, created_at, activated_at, " +
  "prep_minutes, cook_minutes, rest_minutes, shelf_life_hours, storage, serving, portion_size, extra_allergens, " +
  "pasos:recipe_steps(id, position, title, description, minutes, temperature_c, equipment_id, is_critical), " +
  "ingredientes:recipe_ingredients(id, position, ingredient_id, sub_recipe_id, quantity, unit, quantity_type), " +
  "equipos:recipe_equipment_usage(id, equipment_id, minutes, usage_share, preheat_share, measured_consumption), " +
  "personal:recipe_labor_usage(id, labor_profile_id, active_minutes), " +
  "consumibles:recipe_consumables(id, consumable_id)";

export async function cargarVersion(sb: SupabaseClient, versionId: string): Promise<Version | null> {
  const { data } = await sb.from("recipe_versions").select(COLS_VERSION).eq("id", versionId).maybeSingle();
  if (!data) return null;
  const v = data as unknown as Version;
  v.ingredientes.sort((a, b) => a.position - b.position);
  v.pasos = (v.pasos ?? []).sort((a, b) => a.position - b.position);
  v.extra_allergens = v.extra_allergens ?? [];
  return v;
}

export async function cargarRecetas(sb: SupabaseClient, rid: string): Promise<Receta[]> {
  const { data } = await sb.from("recipes")
    .select("id, restaurant_id, name, kind, category, active_version_id, status, version")
    .eq("restaurant_id", rid).eq("status", "active").order("kind").order("name");
  return (data ?? []) as Receta[];
}

export const editable = (v: Version, kind: Receta["kind"]): VersionEditable => ({
  kind,
  portions: v.portions, yield_quantity: v.yield_quantity, yield_unit: v.yield_unit,
  labor_is_variable: v.labor_is_variable, use_overheads: v.use_overheads,
  ingredientes: v.ingredientes, equipos: v.equipos, personal: v.personal, consumibles: v.consumibles,
});

/**
 * Catálogo plano del restaurante (serializable, se puede pasar al navegador),
 * con el coste por unidad de cada elaboración calculado con su versión activa.
 */
export async function cargarCatalogo(sb: SupabaseClient, rid: string, orgId: string): Promise<{ cat: CatalogoPlano; recetas: Receta[] }> {
  const [ings, eqs, perfiles, tarifas, cons, recetas, overheads] = await Promise.all([
    cargarIngredientes(sb, rid, orgId), cargarEquipos(sb, rid), cargarPerfiles(sb, rid), cargarTarifas(sb, rid),
    cargarConsumibles(sb, rid), cargarRecetas(sb, rid), gastosGeneralesPorRacion(sb, rid),
  ]);
  const vig = new Map(tarifasVigentes(tarifas).map((t) => [t.id, t]));
  const cat: CatalogoPlano = {
    ingredientes: Object.fromEntries(ings.map((i) => [i.id, {
      id: i.id, name: i.name, baseUnit: i.base_unit, yieldRatio: i.yield_ratio,
      densityGPerMl: i.density_g_per_ml, unitWeightG: i.unit_weight_g, unitVolumeMl: i.unit_volume_ml,
      pricePerBaseUnit: i.precio?.price_per_base_unit ?? null, priceQuality: i.precio?.quality ?? "measured",
      allergens: i.allergens ?? [], category: i.category,
    }])),
    equipos: Object.fromEntries(eqs.map((e) => {
      const t = e.energy_tariff_id ? vig.get(e.energy_tariff_id) : undefined;
      return [e.id, {
        name: e.name, source: e.energy_source, nominalPowerW: e.nominal_power_w, powerQuality: e.power_quality,
        dutyFactor: e.duty_factor, dutyFactorQuality: e.duty_factor_quality, preheatMinutes: e.preheat_minutes,
        tariffPricePerUnit: t?.price_per_unit ?? null, tariffUnit: t?.unit ?? (e.energy_source === "water" ? "m3" : "kWh"),
      }];
    })),
    perfiles: Object.fromEntries(perfiles.map((p) => [p.id, { name: p.name, costPerHour: p.cost_per_hour }])),
    consumibles: Object.fromEntries(cons.map((c) => [c.id, {
      name: c.name, amount: c.amount, per: c.imputation_unit === "portion" || c.imputation_unit === "batch" ? c.imputation_unit : null,
    }])),
    subrecetas: {},
    overheads,
  };

  // Coste de cada elaboración activa (resolviendo elaboraciones dentro de elaboraciones)
  const preps = recetas.filter((r) => r.kind === "preparation");
  const versiones = new Map<string, Version>();
  await Promise.all(preps.filter((p) => p.active_version_id).map(async (p) => {
    const v = await cargarVersion(sb, p.active_version_id!);
    if (v) versiones.set(p.id, v);
  }));
  const enCurso = new Set<string>();
  const resolver = (p: Receta) => {
    if (cat.subrecetas[p.id]) return;
    const v = versiones.get(p.id);
    if (!v) {
      cat.subrecetas[p.id] = { name: p.name, baseUnit: "g", costPerUnit: null, status: "sin_version", allergens: [] };
      return;
    }
    if (enCurso.has(p.id)) return; // la base de datos impide ciclos; esto es solo una protección
    enCurso.add(p.id);
    for (const l of v.ingredientes) {
      const sub = l.sub_recipe_id ? preps.find((x) => x.id === l.sub_recipe_id) : undefined;
      if (sub) resolver(sub);
    }
    const r = calcularDesdeCatalogo(editable(v, "preparation"), cat).result;
    cat.subrecetas[p.id] = {
      name: p.name, baseUnit: v.yield_unit ?? "g", costPerUnit: r.costs.direct_per_portion, status: r.status,
      allergens: alergenosDe(editable(v, "preparation"), cat, v.extra_allergens),
    };
    enCurso.delete(p.id);
  };
  preps.forEach(resolver);
  return { cat, recetas };
}

export function calcularVersion(v: Version, receta: Receta, cat: CatalogoPlano, channel?: ChannelInput): ResultadoCalculo {
  return calcularDesdeCatalogo(editable(v, receta.kind), cat, channel);
}

/** Guarda una fotografía de coste (nunca se reescribe). */
export async function guardarFotografia(
  sb: SupabaseClient, receta: Receta, versionId: string, r: CalculationResult,
  motivo: "manual" | "activation" | "price_change" | "recalculation",
) {
  return sb.from("cost_snapshots").insert({
    restaurant_id: receta.restaurant_id,
    recipe_id: receta.id,
    recipe_version_id: versionId,
    valuation_date: r.valuation_date,
    status: r.status,
    direct_per_unit: r.costs.direct_per_portion,
    full_per_unit: r.costs.total_per_portion,
    batch_direct: r.batch.direct,
    reason: motivo,
    result: r,
    engine_version: ENGINE_VERSION,
  });
}

/**
 * Recalcula recetas activas, guarda nuevas fotografías y genera avisos si el
 * coste cambia más del umbral. No toca escandallos históricos.
 */
export async function recalcularRecetas(sb: SupabaseClient, rid: string, orgId: string, ids: string[], motivo: "price_change" | "recalculation") {
  if (ids.length === 0) return { recalculadas: 0, avisos: 0 };
  const { cat, recetas } = await cargarCatalogo(sb, rid, orgId);
  const { data: ajustes } = await sb.from("restaurant_settings").select("alert_thresholds").eq("restaurant_id", rid).maybeSingle();
  const umbral = Number((ajustes?.alert_thresholds as { cost_change_pct?: number } | null)?.cost_change_pct ?? 5);
  let recalculadas = 0;
  let avisos = 0;

  for (const id of ids) {
    const receta = recetas.find((r) => r.id === id);
    if (!receta?.active_version_id) continue;
    const version = await cargarVersion(sb, receta.active_version_id);
    if (!version) continue;
    const { result } = calcularVersion(version, receta, cat);
    const { data: previa } = await sb.from("cost_snapshots").select("direct_per_unit").eq("recipe_id", id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    await guardarFotografia(sb, receta, version.id, result, motivo);
    recalculadas++;
    const antes = previa?.direct_per_unit ? Number(previa.direct_per_unit) : null;
    const ahora = result.costs.direct_per_portion ? Number(result.costs.direct_per_portion) : null;
    if (antes && ahora && antes > 0) {
      const cambio = ((ahora - antes) / antes) * 100;
      if (Math.abs(cambio) >= umbral) {
        const unidad = receta.kind === "dish" ? "ración" : "unidad";
        await sb.from("alerts").insert({
          restaurant_id: rid,
          kind: "cost_change",
          severity: Math.abs(cambio) >= umbral * 2 ? "critical" : "warning",
          title: `${receta.name}: el coste ${cambio > 0 ? "sube" : "baja"} un ${Math.abs(cambio).toFixed(1).replace(".", ",")} %`,
          body: `Coste directo por ${unidad}: ${fmtE(antes)} → ${fmtE(ahora)}.`,
          data: { recipe_id: id, antes, ahora, cambio },
        });
        avisos++;
      }
    }
  }
  return { recalculadas, avisos };
}

/** Tras un cambio de precio: recetas activas que usan esos ingredientes (también vía elaboraciones). */
export async function recalcularDependientes(sb: SupabaseClient, rid: string, orgId: string, ingredientIds: string[]) {
  if (ingredientIds.length === 0) return { recalculadas: 0, avisos: 0 };
  const { data } = await sb.rpc("recipes_using_ingredients", { p_restaurant: rid, p_ingredients: ingredientIds });
  const ids = ((data ?? []) as { recipe_id: string }[]).map((x) => x.recipe_id);
  return recalcularRecetas(sb, rid, orgId, ids, "price_change");
}

/** Recetas activas que usan una elaboración (directa o indirectamente). */
export async function recetasQueUsan(sb: SupabaseClient, recipeId: string): Promise<string[]> {
  const encontradas = new Set<string>();
  let frontera = [recipeId];
  for (let i = 0; i < 6 && frontera.length; i++) {
    const { data } = await sb.from("recipe_ingredients")
      .select("sub_recipe_id, recipe_versions!inner(recipe_id, status)")
      .in("sub_recipe_id", frontera)
      .eq("recipe_versions.status", "active");
    const nuevas = ((data ?? []) as unknown as { recipe_versions: { recipe_id: string } }[])
      .map((x) => x.recipe_versions.recipe_id).filter((x) => !encontradas.has(x));
    nuevas.forEach((x) => encontradas.add(x));
    frontera = nuevas;
  }
  return [...encontradas];
}

const fmtE = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
