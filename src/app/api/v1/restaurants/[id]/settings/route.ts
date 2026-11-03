import { z } from "zod";
import { api, ApiError, body, dbError, ifMatch } from "@/lib/api/http";

const COLS = "restaurant_id, organization_id, opening_hours, price_policy, money_decimals, targets, alert_thresholds, updated_at, version";

export const GET = api<{ id: string }>(async ({ supabase }, { id }) => {
  const { data, error } = await supabase.from("restaurant_settings").select(COLS).eq("restaurant_id", id).single();
  if (error) dbError(error);
  return Response.json({ data }, { headers: { etag: `"${data.version}"` } });
});

const Patch = z.object({
  opening_hours: z.record(z.string(), z.unknown()).optional(),
  price_policy: z.enum(["last_validated", "weighted_average"]).optional(),
  money_decimals: z.number().int().min(0).max(6).optional(),
  targets: z.record(z.string(), z.unknown()).optional(),
  alert_thresholds: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const PATCH = api<{ id: string }>(async ({ supabase, request }, { id }) => {
  const version = ifMatch(request);
  const input = await body(request, Patch);
  const { data, error } = await supabase
    .from("restaurant_settings").update(input).eq("restaurant_id", id).eq("version", version).select(COLS);
  if (error) dbError(error);
  if (!data || data.length === 0) {
    throw new ApiError(412, "precondition_failed", "La versión no coincide o no tienes permiso. Vuelve a leer el recurso.");
  }
  return Response.json({ data: data[0] }, { headers: { etag: `"${data[0].version}"` } });
});
