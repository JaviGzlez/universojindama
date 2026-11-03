import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContexto } from "@/lib/contexto";

export default async function Panel() {
  const ctx = await getContexto();
  if (!ctx || ctx.restaurants.length === 0) redirect("/acceso");
  const ultimo = (await cookies()).get("uj_restaurante")?.value;
  const destino = ctx.restaurants.find((r) => r.id === ultimo) ?? ctx.restaurants[0];
  redirect(`/panel/${destino.id}`);
}
