import { z } from "zod";
import { api, body, dbError } from "@/lib/api/http";

const COLS = "id, organization_id, name, slug, currency, timezone, status, created_at, updated_at, version";

export const GET = api<{ id: string }>(async ({ supabase }, { id }) => {
  const { data, error } = await supabase.from("restaurants").select(COLS).eq("organization_id", id).order("name");
  if (error) dbError(error);
  return { data };
});

const Crear = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  currency: z.string().length(3).default("EUR"),
  timezone: z.string().min(1).max(60).default("Europe/Madrid"),
}).strict();

/** Solo propietarios (RLS). */
export const POST = api<{ id: string }>(async ({ supabase, request }, { id }) => {
  const input = await body(request, Crear);
  const { data, error } = await supabase.from("restaurants").insert({ ...input, organization_id: id }).select(COLS).single();
  if (error) dbError(error);
  return Response.json({ data }, { status: 201 });
});
