import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOMBRE_ROL, type Rol, type Restaurante } from "@/lib/contexto";

type Datos = Record<string, unknown> | null;

interface Evento {
  id: number;
  restaurant_id: string | null;
  actor_id: string | null;
  table_name: string;
  row_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: Datos;
  new_data: Datos;
  occurred_at: string;
}

export interface Actividad {
  id: number;
  cuando: string;
  quien: string;
  quienId: string | null;
  texto: string;
  detalle: string | null;
  restaurante: string | null;
  tipo: "crear" | "cambiar" | "archivar" | "acceso" | "precio";
}

const eur = (v: unknown, dec = 2) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(v));
const num = (v: unknown, max = 2) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: max }).format(Number(v));
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const CAMPOS: Record<string, string> = {
  name: "nombre", category: "categoría", base_unit: "unidad", yield_ratio: "rendimiento", density_g_per_ml: "densidad",
  unit_weight_g: "peso por unidad", unit_volume_ml: "volumen por unidad", allergens: "alérgenos", storage: "conservación", source: "fuente",
  nominal_power_w: "potencia", power_quality: "origen de la potencia", duty_factor: "factor de funcionamiento", preheat_minutes: "precalentamiento",
  batch_capacity: "capacidad", energy_tariff_id: "tarifa", energy_source: "fuente energética", measured_consumption_per_hour: "consumo medido",
  period_cost: "coste del periodo", productive_hours: "horas productivas", includes: "qué incluye", period_label: "periodo",
  price_per_unit: "precio", unit: "unidad", valid_from: "vigencia", valid_to: "fin de vigencia", includes_taxes: "impuestos incluidos",
  rate: "tipo", recoverable: "recuperable", kind: "tipo de impuesto", amount: "importe", imputation_unit: "imputación", rule: "regla",
  price_policy: "política de precios", money_decimals: "decimales", opening_hours: "horario", targets: "objetivos", alert_thresholds: "avisos",
  timezone: "zona horaria", currency: "moneda", notes: "notas", status: "estado",
};
const IGNORAR = new Set(["updated_at", "version", "created_at", "cost_per_hour", "organization_id", "restaurant_id", "id"]);

function cambios(o: Datos, n: Datos) {
  if (!o || !n) return [];
  return Object.keys(n).filter((k) => !IGNORAR.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => CAMPOS[k] ?? k);
}

const OBJETO: Record<string, { art: string; nombre: string }> = {
  ingredients: { art: "la materia prima", nombre: "materia prima" },
  equipment: { art: "el equipo", nombre: "equipo" },
  labor_profiles: { art: "el perfil", nombre: "perfil" },
  energy_tariffs: { art: "la tarifa", nombre: "tarifa" },
  tax_rates: { art: "el impuesto", nombre: "impuesto" },
  consumables: { art: "el consumible", nombre: "consumible" },
};

const REF_UNIDAD: Record<string, { f: number; u: string }> = { g: { f: 1000, u: "kg" }, ml: { f: 1000, u: "l" }, unit: { f: 1, u: "ud" } };

export async function cargarActividad(
  sb: SupabaseClient,
  opciones: { restaurantes: Restaurante[]; restauranteId?: string; quien?: string; antes?: string; limite?: number },
): Promise<{ items: Actividad[]; siguiente: string | null }> {
  const limite = opciones.limite ?? 60;
  let q = sb.from("audit_events")
    .select("id, restaurant_id, actor_id, table_name, row_id, action, old_data, new_data, occurred_at")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite + 1);
  if (opciones.restauranteId) q = q.or(`restaurant_id.eq.${opciones.restauranteId},restaurant_id.is.null`);
  if (opciones.quien) q = q.eq("actor_id", opciones.quien);
  if (opciones.antes) q = q.lt("occurred_at", opciones.antes);
  const { data } = await q;
  const filas = (data ?? []) as Evento[];
  const hayMas = filas.length > limite;
  const eventos = hayMas ? filas.slice(0, limite) : filas;

  // Referencias: personas e ingredientes
  const personas = new Set<string>();
  const ingIds = new Set<string>();
  for (const e of eventos) {
    if (e.actor_id) personas.add(e.actor_id);
    const d = e.new_data ?? e.old_data;
    if (e.table_name === "memberships" && d?.user_id) personas.add(s(d.user_id));
    if (e.table_name === "ingredient_prices" && d?.ingredient_id) ingIds.add(s(d.ingredient_id));
  }
  const [{ data: perfiles }, { data: ings }] = await Promise.all([
    personas.size ? sb.from("profiles").select("user_id, display_name").in("user_id", [...personas]) : Promise.resolve({ data: [] }),
    ingIds.size ? sb.from("ingredients").select("id, name, base_unit").in("id", [...ingIds]) : Promise.resolve({ data: [] }),
  ]);
  const nombre = new Map((perfiles ?? []).map((p) => [p.user_id as string, p.display_name as string]));
  const ing = new Map((ings ?? []).map((i) => [i.id as string, i as { name: string; base_unit: string }]));
  const rest = new Map(opciones.restaurantes.map((r) => [r.id, r.name]));

  // set_member_access borra y vuelve a crear accesos en la misma transacción: se muestra solo el alta
  const altas = new Set(eventos.filter((e) => e.table_name === "memberships" && e.action === "INSERT").map((e) => `${e.occurred_at}|${s(e.new_data?.user_id)}`));

  const items: Actividad[] = [];
  for (const e of eventos) {
    if (e.table_name === "restaurant_settings" && e.action === "INSERT") continue;
    if (e.table_name === "memberships" && e.action === "DELETE" && altas.has(`${e.occurred_at}|${s(e.old_data?.user_id)}`)) continue;
    const r = describir(e, { nombre, ing, rest });
    if (!r) continue;
    items.push({
      id: e.id,
      cuando: e.occurred_at,
      quien: e.actor_id ? nombre.get(e.actor_id) ?? "Alguien del equipo" : "Sistema",
      quienId: e.actor_id,
      restaurante: e.restaurant_id ? rest.get(e.restaurant_id) ?? null : null,
      ...r,
    });
  }
  return { items, siguiente: hayMas ? eventos[eventos.length - 1].occurred_at : null };
}

function describir(
  e: Evento,
  ref: { nombre: Map<string, string>; ing: Map<string, { name: string; base_unit: string }>; rest: Map<string, string> },
): Pick<Actividad, "texto" | "detalle" | "tipo"> | null {
  const n = e.new_data ?? {};
  const o = e.old_data ?? {};
  const nom = s(n.name ?? o.name);

  if (e.table_name in OBJETO) {
    const obj = OBJETO[e.table_name];
    if (e.action === "INSERT") {
      let detalle: string | null = null;
      if (e.table_name === "labor_profiles" && n.cost_per_hour) detalle = `${eur(n.cost_per_hour)}/h`;
      if (e.table_name === "energy_tariffs") detalle = `${eur(n.price_per_unit, 4)}/${s(n.unit)}`;
      if (e.table_name === "tax_rates") detalle = `${num(Number(n.rate) * 100)} % · ${n.kind === "sale" ? "venta" : "compra"}`;
      if (e.table_name === "consumables") detalle = eur(n.amount, 4);
      if (e.table_name === "equipment" && n.nominal_power_w) detalle = `${num(n.nominal_power_w, 0)} W`;
      if (e.table_name === "ingredients" && n.restaurant_id === null) detalle = "Catálogo compartido del grupo";
      return { texto: `añadió ${obj.art} «${nom}»`, detalle, tipo: "crear" };
    }
    if (e.action === "UPDATE") {
      if (o.status === "active" && n.status === "archived") return { texto: `archivó ${obj.art} «${nom}»`, detalle: null, tipo: "archivar" };
      if (o.status === "archived" && n.status === "active") return { texto: `recuperó ${obj.art} «${nom}»`, detalle: null, tipo: "cambiar" };
      const c = cambios(o, n);
      if (c.length === 0) return null;
      return { texto: `modificó ${obj.art} «${nom}»`, detalle: `Cambió: ${c.join(", ")}`, tipo: "cambiar" };
    }
    return { texto: `eliminó ${obj.art} «${nom}»`, detalle: null, tipo: "archivar" };
  }

  switch (e.table_name) {
    case "ingredient_prices": {
      const i = ref.ing.get(s(n.ingredient_id));
      const u = REF_UNIDAD[i?.base_unit ?? "unit"];
      return {
        texto: `registró un precio para «${i?.name ?? "un ingrediente"}»`,
        detalle: n.price_per_base_unit !== undefined ? `${eur(Number(n.price_per_base_unit) * u.f)} / ${u.u}` : null,
        tipo: "precio",
      };
    }
    case "restaurant_settings": {
      const c = cambios(o, n);
      return c.length ? { texto: "cambió los ajustes del restaurante", detalle: `Cambió: ${c.join(", ")}`, tipo: "cambiar" } : null;
    }
    case "restaurants":
      if (e.action === "INSERT") return { texto: `creó el restaurante «${nom}»`, detalle: null, tipo: "crear" };
      return cambios(o, n).length ? { texto: `modificó los datos de «${nom}»`, detalle: `Cambió: ${cambios(o, n).join(", ")}`, tipo: "cambiar" } : null;
    case "memberships": {
      const d = e.action === "DELETE" ? o : n;
      const persona = ref.nombre.get(s(d.user_id)) ?? "una persona";
      const donde = d.restaurant_id ? ref.rest.get(s(d.restaurant_id)) ?? "un restaurante" : "todos los restaurantes";
      const rol = NOMBRE_ROL[d.role as Rol] ?? s(d.role);
      if (e.action === "DELETE") return { texto: `retiró el acceso a ${persona}`, detalle: `${rol} · ${donde}`, tipo: "acceso" };
      return { texto: `dio acceso a ${persona}`, detalle: `${rol} · ${donde}`, tipo: "acceso" };
    }
    case "profiles":
      return { texto: `cambió el nombre «${s(o.display_name)}» por «${s(n.display_name)}»`, detalle: null, tipo: "cambiar" };
    default:
      return null;
  }
}

export function haceCuanto(iso: string, ahora = Date.now()) {
  const seg = Math.round((ahora - new Date(iso).getTime()) / 1000);
  if (seg < 60) return "ahora mismo";
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return null;
}

export function diaDe(iso: string, tz: string) {
  const f = (d: Date) => new Intl.DateTimeFormat("es-ES", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const dia = f(new Date(iso));
  if (dia === f(new Date())) return "Hoy";
  if (dia === f(new Date(Date.now() - 86400000))) return "Ayer";
  return new Intl.DateTimeFormat("es-ES", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

export function horaDe(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
