import Decimal from "decimal.js";
import type { Num } from "./types";

/** Instancia aislada: precisión alta, redondeo half-up. Nunca coma flotante para dinero. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export const SERIALIZED_DECIMALS = 6;

/** Convierte una entrada a decimal. Acepta coma decimal española. Devuelve null si no es un número válido. */
export function dec(value: Num | null | undefined): Dec | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "number" ? value.toString() : value.trim().replace(",", ".");
  if (raw === "") return null;
  try {
    const d = new D(raw);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function ser(value: Dec | null): string | null {
  return value === null ? null : value.toDecimalPlaces(SERIALIZED_DECIMALS).toFixed(SERIALIZED_DECIMALS);
}

/** Formato legible para fórmulas: coma decimal, sin ceros sobrantes. */
export function fmt(value: Dec | null, maxDecimals = 6): string {
  if (value === null) return "?";
  return value.toDecimalPlaces(maxDecimals).toString().replace(".", ",");
}

export function sum(values: (Dec | null)[]): Dec | null {
  let total = new D(0);
  for (const v of values) {
    if (v === null) return null;
    total = total.plus(v);
  }
  return total;
}

export function safeDiv(a: Dec | null, b: Dec | null): Dec | null {
  if (a === null || b === null || b.isZero()) return null;
  return a.div(b);
}
