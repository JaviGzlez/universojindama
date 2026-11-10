/**
 * Construcción pura de la entrada del motor a partir de una versión de receta.
 * La usan el servidor (guardar, recalcular) y el editor en el navegador, así el
 * resultado que se ve al editar es exactamente el que se guarda.
 */
import { calculate, type CalculationInput, type CalculationResult, type ChannelInput, type DataQuality, type EnergySource, type IngredientRef, type QuantityUnit } from "@/lib/engine";

export interface CatalogoPlano {
  ingredientes: Record<string, IngredientRef & { archivado?: boolean; allergens?: string[]; category?: string | null }>;
  equipos: Record<string, {
    name: string; source: EnergySource; nominalPowerW: string | null; powerQuality: DataQuality;
    dutyFactor: string; dutyFactorQuality: DataQuality; preheatMinutes: string;
    tariffPricePerUnit: string | null; tariffUnit: string;
  }>;
  perfiles: Record<string, { name: string; costPerHour: string }>;
  consumibles: Record<string, { name: string; amount: string; per: "portion" | "batch" | null }>;
  /** Elaboraciones: coste directo por unidad base de su versión activa */
  subrecetas: Record<string, { name: string; baseUnit: "g" | "ml" | "unit"; costPerUnit: string | null; status: CalculationResult["status"] | "sin_version"; allergens?: string[] }>;
  overheads: { value: string; detalle: string } | null;
}

export interface VersionEditable {
  kind: "preparation" | "dish";
  portions: string | null;
  yield_quantity: string | null;
  yield_unit: "g" | "ml" | "unit" | null;
  labor_is_variable: boolean;
  use_overheads: boolean;
  ingredientes: { ingredient_id: string | null; sub_recipe_id: string | null; quantity: string; unit: QuantityUnit; quantity_type: "net" | "gross" }[];
  equipos: { equipment_id: string; minutes: string; usage_share: string; preheat_share: string; measured_consumption: string | null }[];
  personal: { labor_profile_id: string; active_minutes: string }[];
  consumibles: { consumable_id: string }[];
}

export interface ResultadoCalculo {
  input: CalculationInput;
  result: CalculationResult;
  unidad: string;
  avisos: string[];
}

const UNIDAD = { g: "g", ml: "ml", unit: "ud" } as const;

export function calcularDesdeCatalogo(v: VersionEditable, cat: CatalogoPlano, channel?: ChannelInput, fecha = new Date().toISOString().slice(0, 10)): ResultadoCalculo {
  const avisos: string[] = [];
  const ingredients: CalculationInput["ingredients"] = v.ingredientes.map((l) => {
    if (l.sub_recipe_id) {
      const s = cat.subrecetas[l.sub_recipe_id];
      if (!s) avisos.push("Una elaboración usada ya no está disponible.");
      else if (s.status === "sin_version") avisos.push(`«${s.name}» no tiene versión activa.`);
      else if (s.status === "incomplete") avisos.push(`«${s.name}» tiene datos pendientes.`);
      return {
        ingredient: {
          id: `rec:${l.sub_recipe_id}`, name: s ? `${s.name} (elaboración)` : "Elaboración no disponible",
          baseUnit: s?.baseUnit ?? "g", yieldRatio: 1, pricePerBaseUnit: s?.costPerUnit ?? null,
          priceQuality: s?.status === "estimated" ? "estimated" : "measured",
        },
        quantity: l.quantity, unit: l.unit, quantityType: "gross" as const,
      };
    }
    const i = l.ingredient_id ? cat.ingredientes[l.ingredient_id] : undefined;
    return {
      ingredient: i ?? { id: l.ingredient_id ?? "?", name: "Materia prima no disponible", baseUnit: "g", yieldRatio: 1, pricePerBaseUnit: null },
      quantity: l.quantity, unit: l.unit, quantityType: l.quantity_type,
    };
  });

  const equipment: CalculationInput["equipment"] = v.equipos.map((u) => {
    const e = cat.equipos[u.equipment_id];
    return {
      id: u.equipment_id, name: e?.name ?? "Equipo no disponible", source: e?.source ?? "electricity", minutes: u.minutes,
      nominalPowerW: e?.nominalPowerW ?? null, powerQuality: e?.powerQuality, dutyFactor: e?.dutyFactor ?? 1,
      dutyFactorQuality: e?.dutyFactorQuality, measuredConsumption: u.measured_consumption,
      preheatMinutes: e?.preheatMinutes ?? 0, preheatShare: u.preheat_share, usageShare: u.usage_share,
      tariffPricePerUnit: e?.tariffPricePerUnit ?? null, tariffUnit: e?.tariffUnit ?? "kWh",
    };
  });

  const labor: CalculationInput["labor"] = v.personal.map((p) => {
    const x = cat.perfiles[p.labor_profile_id];
    return { id: p.labor_profile_id, name: x?.name ?? "Perfil no disponible", activeMinutes: p.active_minutes, costPerHour: x?.costPerHour ?? null };
  });

  const consumables: CalculationInput["consumables"] = v.consumibles.map((c) => {
    const x = cat.consumibles[c.consumable_id];
    return { id: c.consumable_id, name: x?.name ?? "Consumible no disponible", amount: x?.per ? x.amount : null, per: x?.per ?? "portion" };
  });

  const esPlato = v.kind === "dish";
  const overheads = esPlato && v.use_overheads && cat.overheads ? cat.overheads.value : null;
  if (esPlato && v.use_overheads && !cat.overheads) {
    avisos.push("Sin base para repartir gastos generales: indica las raciones previstas al mes en Ajustes y registra gastos en Economía.");
  }

  const input: CalculationInput = {
    currency: "EUR",
    valuationDate: fecha,
    // en una elaboración la «ración» es su unidad base: el resultado es coste por g/ml/ud
    portions: (esPlato ? v.portions : v.yield_quantity) ?? "",
    ingredients, equipment, labor, consumables,
    overheadsPerPortion: overheads,
    overheadsQuality: "estimated",
    laborIsVariable: v.labor_is_variable,
    channel: esPlato ? channel : undefined,
  };
  const result = calculate(input);
  if (!esPlato) {
    result.missing_inputs = result.missing_inputs.filter((m) => m.code !== "OVERHEADS_NOT_CONFIGURED");
    result.coverage.full_cost = "not_requested";
    if (result.missing_inputs.some((m) => m.code === "PORTIONS_INVALID")) {
      result.missing_inputs = result.missing_inputs.map((m) => m.code === "PORTIONS_INVALID" ? { ...m, message: "Indica la cantidad que produce la elaboración." } : m);
    }
  }
  if (esPlato && overheads && cat.overheads) result.assumptions.push(`Gastos generales: ${cat.overheads.detalle}.`);
  return { input, result, unidad: esPlato ? "ración" : UNIDAD[v.yield_unit ?? "g"], avisos };
}

/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011). */
export const ALERGENOS = [
  "gluten", "crustáceos", "huevo", "pescado", "cacahuetes", "soja", "leche",
  "frutos de cáscara", "apio", "mostaza", "sésamo", "sulfitos", "altramuces", "moluscos",
] as const;

/** Alérgenos de una receta: los de sus materias primas y elaboraciones + los añadidos a mano. */
export function alergenosDe(v: Pick<VersionEditable, "ingredientes">, cat: CatalogoPlano, extra: string[] = []): string[] {
  const set = new Set<string>(extra.map((a) => a.toLowerCase()));
  for (const l of v.ingredientes) {
    const lista = l.sub_recipe_id ? cat.subrecetas[l.sub_recipe_id]?.allergens : l.ingredient_id ? cat.ingredientes[l.ingredient_id]?.allergens : undefined;
    for (const a of lista ?? []) set.add(a.toLowerCase());
  }
  return [...set].sort((a, b) => {
    const ia = ALERGENOS.indexOf(a as (typeof ALERGENOS)[number]);
    const ib = ALERGENOS.indexOf(b as (typeof ALERGENOS)[number]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}
