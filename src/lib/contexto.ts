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
  permissions: Partial<Record<Area, Nivel>> | null;
}

/** Apartados con permiso propio (mismos nombres que en la base de datos). */
export const AREAS = ["recetas", "materias", "equipos", "compras", "inventario", "carta", "ventas", "economia", "personal", "ajustes"] as const;
export type Area = (typeof AREAS)[number];
export type Nivel = "none" | "read" | "write";

export const NOMBRE_AREA: Record<Area, string> = {
  recetas: "Recetas y elaboraciones",
  materias: "Materias primas",
  equipos: "Equipos y consumibles",
  compras: "Compras y proveedores",
  inventario: "Inventario y mermas",
  carta: "Carta y canales",
  ventas: "Ventas",
  economia: "Economía",
  personal: "Personal",
  ajustes: "Energía, impuestos y objetivos",
};

/** Casillas por defecto de cada perfil (igual que public.role_area_default). */
export function nivelPorDefecto(rol: Rol, area: Area): Nivel {
  if (rol === "owner" || rol === "admin") return "write";
  const t: Record<string, [Area[], Area[]]> = {
    kitchen: [["recetas", "materias", "equipos", "inventario"], ["carta", "personal", "ajustes"]],
    purchasing: [["materias", "compras", "inventario"], ["recetas", "equipos", "personal", "ajustes"]],
    accounting: [["economia", "ventas", "carta", "personal", "ajustes"], ["compras", "recetas", "inventario", "materias", "equipos"]],
  };
  const x = t[rol];
  if (!x) return "read";
  return x[0].includes(area) ? "write" : x[1].includes(area) ? "read" : "none";
}

/** Apartados que se pueden ver siempre (los necesita cualquier escandallo). */
const LECTURA_ABIERTA: Area[] = ["materias", "equipos", "personal", "ajustes"];

export const getContexto = cache(async () => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [{ data: memberships }, { data: restaurants }, { data: organizations }, { data: perfil }] = await Promise.all([
    supabase.from("memberships").select("organization_id, restaurant_id, role, permissions").eq("user_id", auth.user.id),
    supabase.from("restaurants").select("id, organization_id, name, slug, currency, timezone").eq("status", "active").order("name"),
    supabase.from("organizations").select("id, name, slug").order("name"),
    supabase.from("profiles").select("display_name").eq("user_id", auth.user.id).maybeSingle(),
  ]);

  const memb = (memberships ?? []) as Membresia[];
  const rests = (restaurants ?? []) as Restaurante[];

  const roles = (restaurant: Restaurante): Rol[] =>
    memb
      .filter((m) => m.organization_id === restaurant.organization_id && (m.restaurant_id === null || m.restaurant_id === restaurant.id))
      .map((m) => m.role);

  // Reflejo de public.area_level: la base de datos es quien autoriza de verdad
  const nivel = (restaurant: Restaurante, area: Area): 0 | 1 | 2 => {
    let n: 0 | 1 | 2 = 0;
    for (const m of memb) {
      if (m.organization_id !== restaurant.organization_id || (m.restaurant_id !== null && m.restaurant_id !== restaurant.id)) continue;
      const v = m.role === "owner" || m.role === "admin" ? "write" : m.permissions?.[area] ?? nivelPorDefecto(m.role, area);
      const k = v === "write" ? 2 : v === "read" ? 1 : 0;
      if (k > n) n = k;
    }
    return n;
  };
  const puede = (restaurant: Restaurante, area: Area) => nivel(restaurant, area) === 2;
  const puedeVer = (restaurant: Restaurante, area: Area) => nivel(restaurant, area) >= 1 || (LECTURA_ABIERTA.includes(area) && roles(restaurant).length > 0);

  return {
    supabase,
    user: auth.user,
    nombre: (perfil?.display_name as string | undefined) ?? auth.user.email ?? "",
    restaurants: rests,
    organizations: organizations ?? [],
    roles,
    puede,
    puedeVer,
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
