import { api, dbError } from "@/lib/api/http";

export const GET = api(async ({ supabase }) => {
  const { data, error } = await supabase.from("organizations").select("id, name, slug, status, created_at, updated_at, version").order("name");
  if (error) dbError(error);
  return { data };
});
