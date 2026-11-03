import { D, dec, type Dec } from "./decimal";
import type { IngredientRef, MissingCode, QuantityUnit } from "./types";

type Dimension = "mass" | "volume" | "count";

const UNIT_INFO: Record<QuantityUnit, { dim: Dimension; factor: number }> = {
  g: { dim: "mass", factor: 1 },
  kg: { dim: "mass", factor: 1000 },
  ml: { dim: "volume", factor: 1 },
  l: { dim: "volume", factor: 1000 },
  unit: { dim: "count", factor: 1 },
};

export const BASE_DIM: Record<IngredientRef["baseUnit"], Dimension> = {
  g: "mass",
  ml: "volume",
  unit: "count",
};

export type ConversionResult =
  | { ok: true; value: Dec; note: string | null }
  | { ok: false; code: MissingCode; message: string };

/**
 * Convierte una cantidad a la unidad base del ingrediente.
 * Masa ↔ volumen exige densidad; unidad ↔ masa/volumen exige peso o volumen unitario documentado.
 */
export function toBaseUnit(quantity: Dec, unit: QuantityUnit, ing: IngredientRef): ConversionResult {
  const info = UNIT_INFO[unit];
  // primero a la unidad canónica de su dimensión (g, ml, unidad)
  const canonical = quantity.times(info.factor);
  const target = BASE_DIM[ing.baseUnit];

  if (info.dim === target) return { ok: true, value: canonical, note: null };

  const density = dec(ing.densityGPerMl ?? null);
  const unitWeight = dec(ing.unitWeightG ?? null);
  const unitVolume = dec(ing.unitVolumeMl ?? null);

  const needDensity = (): ConversionResult => ({
    ok: false,
    code: "UNIT_CONVERSION_DENSITY_MISSING",
    message: `«${ing.name}»: para convertir entre masa y volumen hace falta la densidad (g/ml).`,
  });
  const needWeight = (): ConversionResult => ({
    ok: false,
    code: "UNIT_CONVERSION_UNIT_WEIGHT_MISSING",
    message: `«${ing.name}»: para convertir unidades a gramos hace falta el peso por unidad.`,
  });
  const needVolume = (): ConversionResult => ({
    ok: false,
    code: "UNIT_CONVERSION_UNIT_VOLUME_MISSING",
    message: `«${ing.name}»: para convertir unidades a mililitros hace falta el volumen por unidad.`,
  });
  const valid = (d: Dec | null) => d !== null && d.greaterThan(0);

  if (target === "mass") {
    if (info.dim === "volume") return valid(density) ? { ok: true, value: canonical.times(density!), note: "densidad" } : needDensity();
    return valid(unitWeight) ? { ok: true, value: canonical.times(unitWeight!), note: "peso unitario" } : needWeight();
  }
  if (target === "volume") {
    if (info.dim === "mass") return valid(density) ? { ok: true, value: canonical.div(density!), note: "densidad" } : needDensity();
    return valid(unitVolume) ? { ok: true, value: canonical.times(unitVolume!), note: "volumen unitario" } : needVolume();
  }
  // target count
  if (info.dim === "mass") return valid(unitWeight) ? { ok: true, value: canonical.div(unitWeight!), note: "peso unitario" } : needWeight();
  return valid(unitVolume) ? { ok: true, value: canonical.div(unitVolume!), note: "volumen unitario" } : needVolume();
}

export const ZERO = new D(0);
