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
  title: "título", description: "detalles", priority: "prioridad", due_date: "fecha límite", restaurant_ids: "restaurantes", position: "orden",
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
const IGNORAR = new Set(["updated_at", "version", "created_at", "cost_per_hour", "organization_id", "restaurant_id", "id", "completed_at", "completed_by"]);

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
  suppliers: { art: "el proveedor", nombre: "proveedor" },
  supplier_products: { art: "el producto", nombre: "producto" },
  sales_channels: { art: "el canal", nombre: "canal" },
  menu_items: { art: "el plato de carta", nombre: "plato" },
};

/** Tablas cuya actividad se muestra (el resto son detalles internos). */
export const TABLAS_ACTIVIDAD = [
  ...["ingredients", "equipment", "labor_profiles", "energy_tariffs", "tax_rates", "consumables", "suppliers", "supplier_products", "sales_channels", "menu_items"],
  "ingredient_prices", "restaurant_settings", "restaurants", "memberships", "profiles",
  "recipes", "recipe_versions", "purchase_invoices", "channel_prices", "sales", "stock_movements", "stock_counts",
  "financial_entries", "financial_periods", "import_jobs", "tasks",
];

const REF_UNIDAD: Record<string, { f: number; u: string }> = { g: { f: 1000, u: "kg" }, ml: { f: 1000, u: "l" }, unit: { f: 1, u: "ud" } };

export async function cargarActividad(
  sb: SupabaseClient,
  opciones: { restaurantes: Restaurante[]; restauranteId?: string; soloRestaurante?: boolean; quien?: string; antes?: string; limite?: number; todo?: boolean },
): Promise<{ items: Actividad[]; siguiente: string | null }> {
  const limite = opciones.limite ?? 60;
  let q = sb.from("audit_events")
    .select("id, restaurant_id, actor_id, table_name, row_id, action, old_data, new_data, occurred_at")
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite + 1);
  if (opciones.restauranteId) {
    q = opciones.soloRestaurante ? q.eq("restaurant_id", opciones.restauranteId) : q.or(`restaurant_id.eq.${opciones.restauranteId},restaurant_id.is.null`);
  }
  if (!opciones.todo) q = q.in("table_name", TABLAS_ACTIVIDAD);
  if (opciones.quien) q = q.eq("actor_id", opciones.quien);
  if (opciones.antes) q = q.lt("occurred_at", opciones.antes);
  const { data } = await q;
  const filas = (data ?? []) as Evento[];
  const hayMas = filas.length > limite;
  const eventos = hayMas ? filas.slice(0, limite) : filas;

  // Referencias: personas e ingredientes
  const personas = new Set<string>();
  const ingIds = new Set<string>();
  const recIds = new Set<string>();
  for (const e of eventos) {
    if (e.actor_id) personas.add(e.actor_id);
    const d = e.new_data ?? e.old_data;
    if (e.table_name === "memberships" && d?.user_id) personas.add(s(d.user_id));
    if (e.table_name === "tasks" && d?.assignee_id) personas.add(s(d.assignee_id));
    if (e.table_name === "ingredient_prices" && d?.ingredient_id) ingIds.add(s(d.ingredient_id));
    if (e.table_name === "recipe_versions" && d?.recipe_id) recIds.add(s(d.recipe_id));
  }
  const [{ data: perfiles }, { data: ings }, { data: recs }] = await Promise.all([
    personas.size ? sb.from("profiles").select("user_id, display_name").in("user_id", [...personas]) : Promise.resolve({ data: [] }),
    ingIds.size ? sb.from("ingredients").select("id, name, base_unit").in("id", [...ingIds]) : Promise.resolve({ data: [] }),
    recIds.size ? sb.from("recipes").select("id, name").in("id", [...recIds]) : Promise.resolve({ data: [] }),
  ]);
  const receta = new Map((recs ?? []).map((r) => [r.id as string, r.name as string]));
  const nombre = new Map((perfiles ?? []).map((p) => [p.user_id as string, p.display_name as string]));
  const ing = new Map((ings ?? []).map((i) => [i.id as string, i as { name: string; base_unit: string }]));
  const rest = new Map(opciones.restaurantes.map((r) => [r.id, r.name]));

  // set_member_access borra y vuelve a crear accesos en la misma transacción: se muestra solo el alta
  const altas = new Set(eventos.filter((e) => e.table_name === "memberships" && e.action === "INSERT").map((e) => `${e.occurred_at}|${s(e.new_data?.user_id)}`));

  const items: Actividad[] = [];
  for (const e of eventos) {
    if (e.table_name === "restaurant_settings" && e.action === "INSERT") continue;
    if (e.table_name === "memberships" && e.action === "DELETE" && altas.has(`${e.occurred_at}|${s(e.old_data?.user_id)}`)) continue;
    const r = describir(e, { nombre, ing, rest, receta }) ?? (opciones.todo ? generico(e) : null);
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
  ref: { nombre: Map<string, string>; ing: Map<string, { name: string; base_unit: string }>; rest: Map<string, string>; receta: Map<string, string> },
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
    case "tasks": {
      const tit = `«${s(n.title ?? o.title)}»`;
      const quien = (u: unknown) => (u ? ref.nombre.get(s(u)) ?? "alguien del equipo" : null);
      const ESTADO: Record<string, string> = { pending: "pendiente", in_progress: "en curso", review: "en revisión", done: "completada" };
      if (e.action === "INSERT") return { texto: `creó la tarea ${tit}`, detalle: n.assignee_id ? `Para ${quien(n.assignee_id)}` : "Sin asignar", tipo: "crear" };
      if (e.action === "DELETE") return { texto: `borró la tarea ${tit}`, detalle: null, tipo: "archivar" };
      if (o.assignee_id !== n.assignee_id) {
        if (!n.assignee_id) return { texto: `soltó la tarea ${tit}`, detalle: "Queda sin asignar", tipo: "cambiar" };
        if (n.assignee_id === e.actor_id && !o.assignee_id) return { texto: `se quedó la tarea ${tit}`, detalle: null, tipo: "cambiar" };
        return { texto: `asignó la tarea ${tit} a ${quien(n.assignee_id)}`, detalle: o.status !== n.status ? `Ahora: ${ESTADO[s(n.status)]}` : null, tipo: "cambiar" };
      }
      if (o.status !== n.status) {
        if (n.status === "done") return { texto: `completó la tarea ${tit}`, detalle: null, tipo: "crear" };
        return { texto: `pasó la tarea ${tit} a ${ESTADO[s(n.status)]}`, detalle: null, tipo: "cambiar" };
      }
      const c = cambios(o, n);
      return c.length ? { texto: `modificó la tarea ${tit}`, detalle: `Cambió: ${c.join(", ")}`, tipo: "cambiar" } : null;
    }
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
    case "recipes": {
      const tipo = n.kind === "preparation" || o.kind === "preparation" ? "la elaboración" : "la receta";
      if (e.action === "INSERT") return { texto: `creó ${tipo} «${nom}»`, detalle: null, tipo: "crear" };
      if (o.status === "active" && n.status === "archived") return { texto: `archivó ${tipo} «${nom}»`, detalle: null, tipo: "archivar" };
      if (o.name !== n.name || o.category !== n.category) return { texto: `modificó ${tipo} «${nom}»`, detalle: null, tipo: "cambiar" };
      return null;
    }
    case "recipe_versions": {
      if (e.action === "UPDATE" && o.status === "draft" && n.status === "active") {
        return { texto: `activó la versión ${s(n.number)} de «${ref.receta.get(s(n.recipe_id)) ?? "una receta"}»`, detalle: null, tipo: "precio" };
      }
      if (e.action === "INSERT") return { texto: `abrió el borrador ${s(n.number)} de «${ref.receta.get(s(n.recipe_id)) ?? "una receta"}»`, detalle: null, tipo: "cambiar" };
      return null;
    }
    case "purchase_invoices": {
      const num = s(n.number ?? o.number);
      if (e.action === "INSERT") return { texto: `creó la factura ${num}`, detalle: n.invoice_date ? `Fecha ${s(n.invoice_date)}` : null, tipo: "crear" };
      if (o.status !== n.status) {
        const v = { validated: "validó", posted: "registró", void: "anuló", review: "reabrió", draft: "devolvió a borrador" }[s(n.status)] ?? "cambió";
        return { texto: `${v} la factura ${num}`, detalle: n.status === "posted" ? "Precios e inventario actualizados" : null, tipo: n.status === "posted" ? "precio" : "cambiar" };
      }
      return null;
    }
    case "channel_prices":
      return { texto: "cambió un precio de venta", detalle: `${eur(n.pvp)}${n.pvp_includes_tax ? " con impuestos" : ""}`, tipo: "precio" };
    case "sales":
      return { texto: e.action === "DELETE" ? "borró una venta" : "registró una venta", detalle: n.quantity ? `${num(n.quantity)} uds · ${s(n.sale_date)}` : null, tipo: "crear" };
    case "stock_movements": {
      const k = { waste: "registró una merma", adjustment: "ajustó existencias", transfer_in: "registró una entrada por traspaso", transfer_out: "registró una salida por traspaso", production_in: "registró una producción", production_out: "registró un consumo de producción", purchase: null }[s(n.kind)];
      return k ? { texto: k, detalle: s(n.notes ?? n.reference ?? "") || null, tipo: "cambiar" } : null;
    }
    case "stock_counts":
      return e.action === "INSERT" ? { texto: "hizo un recuento de inventario", detalle: s(n.notes ?? "") || null, tipo: "crear" } : null;
    case "financial_entries": {
      const d = e.action === "DELETE" ? o : n;
      const t = { revenue: "un ingreso", purchase: "una compra", labor: "un gasto de personal", expense: "un gasto" }[s(d.kind)] ?? "un movimiento";
      return { texto: `${e.action === "DELETE" ? "borró" : e.action === "UPDATE" ? "modificó" : "registró"} ${t}`, detalle: `${s(d.category)} · ${eur(d.amount)}`, tipo: "cambiar" };
    }
    case "financial_periods":
      if (o.status !== n.status) return { texto: `${n.status === "closed" ? "cerró" : "reabrió"} el periodo ${s(n.month)}/${s(n.year)}`, detalle: null, tipo: "acceso" };
      return null;
    case "import_jobs":
      if (n.status === "applied") return { texto: `importó «${s(n.file_name)}»`, detalle: `${num(n.rows_total, 0)} filas leídas`, tipo: "crear" };
      if (n.status === "reverted") return { texto: `deshizo la importación de «${s(n.file_name)}»`, detalle: null, tipo: "archivar" };
      return null;
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

const TABLA: Record<string, string> = {
  recipe_ingredients: "los ingredientes de una receta", recipe_equipment_usage: "los equipos de una receta",
  recipe_labor_usage: "el personal de una receta", recipe_consumables: "los consumibles de una receta", recipe_steps: "los pasos de una receta",
  recipe_versions: "una versión de receta", purchase_lines: "una línea de factura", stock_count_lines: "una línea de recuento",
  cost_snapshots: "una fotografía de coste", alerts: "un aviso", restaurant_settings: "los ajustes", memberships: "un acceso",
  financial_entries: "un movimiento económico", sales: "una venta", ingredient_prices: "un precio",
};

/** Descripción genérica para el registro completo (cualquier tabla). */
function generico(e: Evento): Pick<Actividad, "texto" | "detalle" | "tipo"> {
  const d = e.new_data ?? e.old_data ?? {};
  const verbo = e.action === "INSERT" ? "añadió" : e.action === "DELETE" ? "borró" : "modificó";
  const que = TABLA[e.table_name] ?? e.table_name.replace(/_/g, " ");
  const etiqueta = s(d.name ?? d.description ?? d.category ?? d.title ?? "");
  const cambios = e.action === "UPDATE" ? Object.keys(e.new_data ?? {}).filter((k) => !IGNORAR.has(k) && JSON.stringify((e.old_data ?? {})[k]) !== JSON.stringify((e.new_data ?? {})[k])).map((k) => CAMPOS[k] ?? k) : [];
  return {
    texto: `${verbo} ${que}${etiqueta ? ` «${etiqueta}»` : ""}`,
    detalle: cambios.length ? `Cambió: ${cambios.join(", ")}` : null,
    tipo: e.action === "DELETE" ? "archivar" : e.action === "INSERT" ? "crear" : "cambiar",
  };
}
