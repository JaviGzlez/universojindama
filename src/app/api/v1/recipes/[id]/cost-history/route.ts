import { api, dbError } from "@/lib/api/http";

/** Fotografías de coste de una receta (nunca se reescriben). */
export const GET = api<{ id: string }>(async ({ supabase }, { id }) => {
  const { data, error } = await supabase.from("cost_snapshots")
    .select("id, recipe_version_id, valuation_date, status, direct_per_unit, full_per_unit, batch_direct, reason, engine_version, created_at")
    .eq("recipe_id", id).order("created_at", { ascending: false }).limit(200);
  if (error) dbError(error);
  return { data };
});
