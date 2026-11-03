import { z } from "zod";
import { api, ApiError, body, dbError } from "@/lib/api/http";

const COLS = "id, restaurant_id, ingredient_id, price_per_base_unit, currency, includes_recoverable_tax, source, quality, valid_from, notes, created_by, created_at";

/** Histórico de precios de un ingrediente en un restaurante (?restaurant_id=). */
export const GET = api<{ id: string }>(async ({ supabase, request }, { id }) => {
  const rid = request.nextUrl.searchParams.get("restaurant_id");
  if (!rid) throw new ApiError(422, "validation_failed", "Indica restaurant_id.");
  const { data, error } = await supabase
    .from("ingredient_prices").select(COLS).eq("ingredient_id", id).eq("restaurant_id", rid)
    .order("valid_from", { ascending: false }).limit(200);
  if (error) dbError(error);
  return { data };
});

const Crear = z.object({
  restaurant_id: z.string().uuid(),
  price_per_base_unit: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d+(\.\d+)?$/.test(v), "Número decimal no válido"),
  quality: z.enum(["measured", "manufacturer", "estimated"]).default("measured"),
  valid_from: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(300).optional(),
}).strict();

/** Un precio nuevo es siempre una fila nueva: el histórico no se reescribe. */
export const POST = api<{ id: string }>(async ({ supabase, request }, { id }) => {
  const input = await body(request, Crear);
  const { data, error } = await supabase
    .from("ingredient_prices").insert({ ...input, ingredient_id: id, source: "manual" }).select(COLS).single();
  if (error) dbError(error);
  return Response.json({ data }, { status: 201 });
});
