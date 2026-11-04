import { api } from "@/lib/api/http";
import { resumenPorRestaurante } from "@/lib/economia";

/** Resumen mensual del año (?year=2026): ingresos, compras, personal, gastos y resultado operativo. */
export const GET = api<{ id: string }>(async ({ supabase, request }, { id }) => {
  const y = Number(request.nextUrl.searchParams.get("year")) || new Date().getUTCFullYear();
  const r = await resumenPorRestaurante(supabase, [id], `${y}-01-01`, `${y}-12-31`);
  return { data: { year: y, months: r.get(id) ?? [] } };
});
