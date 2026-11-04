import { D, dec } from "@/lib/engine/decimal";
import { toBaseUnit } from "@/lib/engine/units";
import type { IngredientRef, QuantityUnit } from "@/lib/engine";

export interface LineaFactura {
  id: string;
  ingredient_id: string | null;
  description: string;
  packs: string;
  pack_quantity: string;
  pack_unit: QuantityUnit;
  pack_price: string;
  discount_pct: string;
  tax_rate: string;
}

export interface LineaCalculada {
  id: string;
  base_quantity: string;
  price_per_base_unit: string;
  line_net: string;
}

export type ResultadoValidacion =
  | { ok: true; lineas: LineaCalculada[]; neto: string; impuestos: string; total: string }
  | { ok: false; errores: string[] };

/**
 * Calcula cada línea al validar: importe neto con su descuento, reparto
 * proporcional del descuento de cabecera y de los portes, cantidad en unidad
 * base del ingrediente y precio por unidad base. Sin coma flotante.
 */
export function calcularFactura(
  lineas: LineaFactura[],
  cabecera: { discount_total: string; shipping: string },
  ingredientes: Record<string, IngredientRef>,
): ResultadoValidacion {
  const errores: string[] = [];
  if (lineas.length === 0) return { ok: false, errores: ["La factura no tiene líneas."] };

  const brutas = lineas.map((l) => {
    const packs = dec(l.packs)!;
    const precio = dec(l.pack_price)!;
    const dto = dec(l.discount_pct) ?? new D(0);
    return packs.times(precio).times(new D(1).minus(dto.div(100)));
  });
  const suma = brutas.reduce((a, b) => a.plus(b), new D(0));
  const descuento = dec(cabecera.discount_total) ?? new D(0);
  const portes = dec(cabecera.shipping) ?? new D(0);
  const neto = suma.minus(descuento).plus(portes);
  if (neto.lessThan(0)) errores.push("El descuento de cabecera es mayor que el importe de las líneas.");

  const calculadas: LineaCalculada[] = [];
  let impuestos = new D(0);
  lineas.forEach((l, i) => {
    if (!l.ingredient_id) { errores.push(`«${l.description}»: asocia la línea a una materia prima.`); return; }
    const ing = ingredientes[l.ingredient_id];
    if (!ing) { errores.push(`«${l.description}»: la materia prima ya no está disponible.`); return; }
    const conv = toBaseUnit(dec(l.pack_quantity)!, l.pack_unit, ing);
    if (!conv.ok) { errores.push(`«${l.description}»: ${conv.message}`); return; }
    const base = conv.value.times(dec(l.packs)!);
    if (base.lessThanOrEqualTo(0)) { errores.push(`«${l.description}»: cantidad no válida.`); return; }
    // reparto proporcional al importe de la línea (si todo es 0, a partes iguales)
    const peso = suma.isZero() ? new D(1).div(lineas.length) : brutas[i].div(suma);
    const lineaNeta = brutas[i].minus(descuento.times(peso)).plus(portes.times(peso));
    impuestos = impuestos.plus(lineaNeta.times(dec(l.tax_rate) ?? 0));
    calculadas.push({
      id: l.id,
      base_quantity: base.toDecimalPlaces(6).toString(),
      price_per_base_unit: lineaNeta.div(base).toDecimalPlaces(8).toString(),
      line_net: lineaNeta.toDecimalPlaces(4).toString(),
    });
  });
  if (errores.length) return { ok: false, errores };
  return {
    ok: true,
    lineas: calculadas,
    neto: neto.toDecimalPlaces(2).toFixed(2),
    impuestos: impuestos.toDecimalPlaces(2).toFixed(2),
    total: neto.plus(impuestos).toDecimalPlaces(2).toFixed(2),
  };
}

export const ESTADO_FACTURA = {
  draft: ["Borrador", "neutro"],
  review: ["En revisión", "estimado"],
  validated: ["Validada", "estimado"],
  posted: ["Registrada", "ok"],
  void: ["Anulada", "pendiente"],
} as const;
