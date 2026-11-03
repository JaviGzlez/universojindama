import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Rol = "owner" | "admin" | "kitchen" | "purchasing" | "accounting" | "viewer";

export const NOMBRE_ROL: Record<Rol, string> = {
  owner: "Propietario",
  admin: "Administrador",
  kitchen: "Cocina",
  purchasing: "Compras",
  accounting: "Administración",
  viewer: "Consulta",
};

export interface Restaurante {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
}

interface Membresia {
  organization_id: string;
  restaurant_id: string | null;
  role: Rol;
}

/**
 * Permisos de escritura que muestra la interfaz. Son un reflejo de las
 * políticas RLS: la base de datos es quien autoriza de verdad.
 */
const ESCRITURA = {
  ingredientes: ["kitchen", "purchasing"],
  precios: ["kitchen", "purchasing"],
  equipos: ["kitchen"],
  personal: ["accounting"],
  tarifas: ["accounting"],
  impuestos: ["accounting"],
  ajustes: ["accounting"],
} satisfies Record<string, Rol[]>;
export type AreaEscritura = keyof typeof ESCRITURA;

export const getContexto = cache(async () => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [{ data: memberships }, { data: restaurants }, { data: organizations }] = await Promise.all([
    supabase.from("memberships").select("organization_id, restaurant_id, role").eq("user_id", auth.user.id),
    supabase.from("restaurants").select("id, organization_id, name, slug, currency, timezone").eq("status", "active").order("name"),
    supabase.from("organizations").select("id, name, slug").order("name"),
  ]);

  const memb = (memberships ?? []) as Membresia[];
  const rests = (restaurants ?? []) as Restaurante[];

  const roles = (restaurant: Restaurante): Rol[] =>
    memb
      .filter((m) => m.organization_id === restaurant.organization_id && (m.restaurant_id === null || m.restaurant_id === restaurant.id))
      .map((m) => m.role);

  const puede = (restaurant: Restaurante, area: AreaEscritura) => {
    const r = roles(restaurant);
    return r.includes("owner") || r.includes("admin") || r.some((x) => (ESCRITURA[area] as Rol[]).includes(x));
  };

  return {
    supabase,
    user: auth.user,
    restaurants: rests,
    organizations: organizations ?? [],
    roles,
    puede,
    esPropietario: (orgId: string) => memb.some((m) => m.organization_id === orgId && m.role === "owner"),
  };
});

export type Contexto = NonNullable<Awaited<ReturnType<typeof getContexto>>>;

/** Contexto + restaurante de la URL. Devuelve null si el usuario no tiene acceso. */
export async function getRestaurante(rid: string) {
  const ctx = await getContexto();
  const restaurante = ctx?.restaurants.find((r) => r.id === rid);
  if (!ctx || !restaurante) return null;
  return { ctx, restaurante };
}
