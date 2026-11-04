import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoMovimiento = "revenue" | "purchase" | "labor" | "expense";

export const NOMBRE_TIPO: Record<TipoMovimiento, string> = {
  revenue: "Ingresos",
  purchase: "Compras",
  labor: "Personal",
  expense: "Gastos",
};

export interface MesResumen {
  mes: string; // YYYY-MM-01
  ingresos: number;
  compras: number;
  personal: number;
  gastos: number;              // operativos
  financiacion: number;        // préstamos (fuera del resultado operativo)
  inversion: number;
  resultado: number;           // ingresos − compras − personal − gastos operativos
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function rangoMeses(meses: number, hasta = new Date()) {
  const fin = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth() + 1, 0));
  const ini = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth() - (meses - 1), 1));
  return { desde: iso(ini), hasta: iso(fin) };
}

export function listaMeses(desde: string, hasta: string) {
  const out: string[] = [];
  const d = new Date(`${desde.slice(0, 7)}-01T00:00:00Z`);
  const fin = new Date(`${hasta.slice(0, 7)}-01T00:00:00Z`);
  while (d <= fin) {
    out.push(iso(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** Cuenta de resultados mensual de uno o varios restaurantes. */
export async function resumenMensual(sb: SupabaseClient, restaurantes: string[], desde: string, hasta: string): Promise<MesResumen[]> {
  const { data } = await sb.rpc("monthly_summary", { p_restaurants: restaurantes, p_from: desde, p_to: hasta });
  const meses = new Map<string, MesResumen>(
    listaMeses(desde, hasta).map((m) => [m, { mes: m, ingresos: 0, compras: 0, personal: 0, gastos: 0, financiacion: 0, inversion: 0, resultado: 0 }]),
  );
  for (const r of (data ?? []) as { month: string; kind: TipoMovimiento; nature: string; total: string }[]) {
    const m = meses.get(r.month);
    if (!m) continue;
    const v = Number(r.total);
    if (r.nature === "financing") m.financiacion += v;
    else if (r.nature === "investment") m.inversion += v;
    else if (r.kind === "revenue") m.ingresos += v;
    else if (r.kind === "purchase") m.compras += v;
    else if (r.kind === "labor") m.personal += v;
    else m.gastos += v;
  }
  for (const m of meses.values()) m.resultado = m.ingresos - m.compras - m.personal - m.gastos;
  return [...meses.values()];
}

/**
 * Gastos generales por ración (estimación): media mensual de los gastos
 * operativos (alquiler, suministros, seguros, gestoría…) de los últimos 3 meses
 * con datos ÷ raciones previstas al mes. No incluye compras ni personal, que ya
 * se imputan directamente en las recetas, ni préstamos o inversiones.
 */
export async function gastosGeneralesPorRacion(sb: SupabaseClient, rid: string): Promise<{ value: string; detalle: string } | null> {
  const { data: ajustes } = await sb.from("restaurant_settings").select("targets").eq("restaurant_id", rid).maybeSingle();
  const previstas = Number((ajustes?.targets as { planned_portions_month?: number } | null)?.planned_portions_month ?? 0);
  if (!previstas || previstas <= 0) return null;

  const hoy = new Date();
  const { desde, hasta } = rangoMeses(6, new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)));
  const meses = (await resumenMensual(sb, [rid], desde, hasta)).filter((m) => m.gastos > 0).slice(-3);
  if (meses.length === 0) return null;
  const media = meses.reduce((a, m) => a + m.gastos, 0) / meses.length;
  const porRacion = media / previstas;
  const nombres = meses.map((m) => new Date(m.mes).toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" })).join(", ");
  return {
    value: porRacion.toFixed(6),
    detalle: `media de gastos operativos (${nombres}) ${media.toFixed(2).replace(".", ",")} € ÷ ${previstas} raciones previstas al mes`,
  };
}

/** Resumen mensual separado por restaurante (una sola consulta). */
export async function resumenPorRestaurante(sb: SupabaseClient, restaurantes: string[], desde: string, hasta: string) {
  const { data } = await sb.rpc("monthly_summary", { p_restaurants: restaurantes, p_from: desde, p_to: hasta });
  const vacio = () => new Map<string, MesResumen>(
    listaMeses(desde, hasta).map((m) => [m, { mes: m, ingresos: 0, compras: 0, personal: 0, gastos: 0, financiacion: 0, inversion: 0, resultado: 0 }]),
  );
  const porRest = new Map<string, Map<string, MesResumen>>(restaurantes.map((r) => [r, vacio()]));
  const conDatos = new Set<string>();
  for (const r of (data ?? []) as { restaurant_id: string; month: string; kind: TipoMovimiento; nature: string; total: string }[]) {
    const m = porRest.get(r.restaurant_id)?.get(r.month);
    if (!m) continue;
    conDatos.add(`${r.restaurant_id}|${r.month}`);
    const v = Number(r.total);
    if (r.nature === "financing") m.financiacion += v;
    else if (r.nature === "investment") m.inversion += v;
    else if (r.kind === "revenue") m.ingresos += v;
    else if (r.kind === "purchase") m.compras += v;
    else if (r.kind === "labor") m.personal += v;
    else m.gastos += v;
  }
  const out = new Map<string, (MesResumen & { conDatos: boolean })[]>();
  for (const [rid, meses] of porRest) {
    out.set(rid, [...meses.values()].map((m) => ({
      ...m, resultado: m.ingresos - m.compras - m.personal - m.gastos, conDatos: conDatos.has(`${rid}|${m.mes}`),
    })));
  }
  return out;
}
