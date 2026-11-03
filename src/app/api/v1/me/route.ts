import { api } from "@/lib/api/http";

export const GET = api(async ({ supabase, user }) => {
  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, restaurant_id, role")
    .eq("user_id", user.id);
  return { data: { id: user.id, email: user.email, memberships: memberships ?? [] } };
});
