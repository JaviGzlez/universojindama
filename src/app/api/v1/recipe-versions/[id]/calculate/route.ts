import { z } from "zod";
import { api, ApiError, body } from "@/lib/api/http";
import { calcularVersion, cargarCatalogo, cargarVersion, type Receta } from "@/lib/recetas";

const Entrada = z.object({
  channel: z.object({
    name: z.string(), pvp: z.union([z.string(), z.number()]).nullable(), pvpIncludesTax: z.boolean(),
    taxRate: z.union([z.string(), z.number()]).nullable(), commissionPct: z.union([z.string(), z.number()]).optional(),
    commissionBase: z.enum(["net", "gross"]).optional(), fixedFeePerOrder: z.union([z.string(), z.number()]).optional(),
    portionsPerOrder: z.union([z.string(), z.number()]).optional(), packagingPerPortion: z.union([z.string(), z.number()]).optional(),
  }).optional(),
}).strict();

/** Calcula una versión con los precios, tarifas y reglas vigentes. No guarda nada (simulación). */
export const POST = api<{ id: string }>(async ({ supabase, request }, { id }) => {
  const input = request.headers.get("content-length") === "0" ? {} : await body(request, Entrada);
  const v = await cargarVersion(supabase, id);
  if (!v) throw new ApiError(404, "not_found", "Versión no encontrada.");
  const { data: rec } = await supabase.from("recipes").select("id, restaurant_id, name, kind, category, active_version_id, status, version").eq("id", v.recipe_id).single();
  const receta = rec as Receta;
  const { data: rest } = await supabase.from("restaurants").select("organization_id").eq("id", receta.restaurant_id).single();
  const { cat } = await cargarCatalogo(supabase, receta.restaurant_id, rest!.organization_id);
  const r = calcularVersion(v, receta, cat, input.channel);
  return { ...r.result, recipe_version_id: id, unit: r.unidad, warnings: r.avisos };
});
