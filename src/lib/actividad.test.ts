import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarActividad } from "./actividad";

const JAVI = "00000000-0000-0000-0000-00000000000a";
const MARIA = "00000000-0000-0000-0000-00000000000b";
const JALEO = "11111111-1111-1111-1111-111111111111";
const ACEITE = "22222222-2222-2222-2222-222222222222";
const T = "2026-11-04T10:00:00Z";

const eventos = [
  { id: 6, restaurant_id: null, actor_id: JAVI, table_name: "memberships", row_id: "m2", action: "INSERT", old_data: null, new_data: { user_id: MARIA, role: "kitchen", restaurant_id: JALEO }, occurred_at: T },
  { id: 5, restaurant_id: null, actor_id: JAVI, table_name: "memberships", row_id: "m1", action: "DELETE", old_data: { user_id: MARIA, role: "viewer", restaurant_id: null }, new_data: null, occurred_at: T },
  { id: 4, restaurant_id: JALEO, actor_id: MARIA, table_name: "ingredient_prices", row_id: "p", action: "INSERT", old_data: null, new_data: { ingredient_id: ACEITE, price_per_base_unit: "0.0065" }, occurred_at: "2026-11-04T09:00:00Z" },
  { id: 3, restaurant_id: JALEO, actor_id: MARIA, table_name: "ingredients", row_id: ACEITE, action: "UPDATE", old_data: { name: "Aceite", yield_ratio: "1", status: "active", version: 1 }, new_data: { name: "Aceite", yield_ratio: "0.95", status: "active", version: 2 }, occurred_at: "2026-11-04T08:00:00Z" },
  { id: 2, restaurant_id: JALEO, actor_id: JAVI, table_name: "equipment", row_id: "e", action: "UPDATE", old_data: { name: "Horno", status: "active" }, new_data: { name: "Horno", status: "archived" }, occurred_at: "2026-11-04T07:00:00Z" },
  { id: 1, restaurant_id: JALEO, actor_id: JAVI, table_name: "labor_profiles", row_id: "l", action: "INSERT", old_data: null, new_data: { name: "Cocinero", cost_per_hour: "16" }, occurred_at: "2026-11-04T06:00:00Z" },
];

function fake(): SupabaseClient {
  const datos: Record<string, unknown[]> = {
    audit_events: eventos,
    profiles: [{ user_id: JAVI, display_name: "Javi" }, { user_id: MARIA, display_name: "María" }],
    ingredients: [{ id: ACEITE, name: "Aceite de oliva", base_unit: "ml" }],
  };
  return {
    from(t: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "or", "eq", "lt", "in"]) b[m] = () => b;
      b.then = (res: (v: unknown) => void) => res({ data: datos[t] });
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("actividad", () => {
  it("convierte los eventos en frases legibles", async () => {
    const { items } = await cargarActividad(fake(), {
      restaurantes: [{ id: JALEO, organization_id: "o", name: "Jaleo", slug: "jaleo", currency: "EUR", timezone: "Europe/Madrid" }],
    });
    const frases = items.map((i) => `${i.quien} ${i.texto}${i.detalle ? ` (${i.detalle})` : ""}`.replace(/\u00a0/g, " "));
    expect(frases).toEqual([
      "Javi dio acceso a María (Cocina · Jaleo)",
      "María registró un precio para «Aceite de oliva» (6,50 € / l)",
      "María modificó la materia prima «Aceite» (Cambió: rendimiento)",
      "Javi archivó el equipo «Horno»",
      "Javi añadió el perfil «Cocinero» (16,00 €/h)",
    ]);
    expect(items[1].restaurante).toBe("Jaleo");
  });
});
