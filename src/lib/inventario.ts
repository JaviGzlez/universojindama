import { D, dec, type Dec } from "@/lib/engine/decimal";
import { toBaseUnit } from "@/lib/engine/units";
import type { IngredientRef, QuantityUnit } from "@/lib/engine";

export interface VersionConsumo {
  kind: "dish" | "preparation";
  portions: string | null;
  yield_quantity: string | null;
  yield_unit: "g" | "ml" | "unit" | null;
  ingredientes: { ingredient_id: string | null; sub_recipe_id: string | null; quantity: string; unit: QuantityUnit; quantity_type: "net" | "gross" }[];
}

/**
 * Cantidad bruta de cada materia prima (en su unidad base) que consume UNA
 * ración de un plato, desplegando las elaboraciones intermedias.
 */
export function consumoPorRacion(
  version: VersionConsumo,
  ingredientes: Record<string, IngredientRef>,
  elaboraciones: Record<string, VersionConsumo | undefined>,
  avisos: Set<string>,
  profundidad = 0,
): Map<string, Dec> {
  const out = new Map<string, Dec>();
  const divisor = dec(version.kind === "dish" ? version.portions : version.yield_quantity);
  if (!divisor || divisor.lessThanOrEqualTo(0) || profundidad > 6) return out;
  const sumar = (id: string, q: Dec) => out.set(id, (out.get(id) ?? new D(0)).plus(q));

  for (const l of version.ingredientes) {
    const q = dec(l.quantity);
    if (!q) continue;
    if (l.ingredient_id) {
      const ing = ingredientes[l.ingredient_id];
      if (!ing) continue;
      const conv = toBaseUnit(q, l.unit, ing);
      if (!conv.ok) { avisos.add(conv.message); continue; }
      const y = dec(ing.yieldRatio) ?? new D(1);
      const bruto = l.quantity_type === "net" ? conv.value.div(y) : conv.value;
      sumar(l.ingredient_id, bruto.div(divisor));
    } else if (l.sub_recipe_id) {
      const sub = elaboraciones[l.sub_recipe_id];
      if (!sub?.yield_unit) { avisos.add("Una elaboración usada no tiene versión activa: su consumo no se cuenta."); continue; }
      const conv = toBaseUnit(q, l.unit, { id: "sub", name: "elaboración", baseUnit: sub.yield_unit, yieldRatio: 1, pricePerBaseUnit: null });
      if (!conv.ok) { avisos.add(conv.message); continue; }
      // consumo por unidad de la elaboración × cantidad usada
      const porUnidad = consumoPorRacion(sub, ingredientes, elaboraciones, avisos, profundidad + 1);
      for (const [id, c] of porUnidad) sumar(id, c.times(conv.value).div(divisor));
    }
  }
  return out;
}

export interface FilaDesviacion {
  ingredient_id: string;
  inicial: number;
  entradas: number;
  mermas: number;
  final: number;
  real: number;
  teorico: number;
  desviacion: number;
  valor: number | null;
}
