import type { SupabaseClient } from "@supabase/supabase-js";

export const ESTADOS = ["pending", "in_progress", "review", "done"] as const;
export type Estado = (typeof ESTADOS)[number];
export const NOMBRE_ESTADO: Record<Estado, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  review: "En revisión",
  done: "Completada",
};

export const PRIORIDADES = ["low", "normal", "high", "urgent"] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
export const NOMBRE_PRIORIDAD: Record<Prioridad, string> = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };

export interface Tarea {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  status: Estado;
  priority: Prioridad;
  due_date: string | null;
  assignee_ids: string[];
  restaurant_ids: string[];
  created_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Persona {
  user_id: string;
  display_name: string;
  all_restaurants: boolean;
  restaurant_ids: string[];
}

export const COLS_TAREA =
  "id, organization_id, title, description, status, priority, due_date, assignee_ids, restaurant_ids, created_by, completed_at, completed_by, position, created_at, updated_at, version";

/** Tareas visibles (la base de datos filtra por restaurante y permisos). Las completadas, solo las últimas. */
export async function cargarTareas(sb: SupabaseClient, org: string) {
  const [abiertas, hechas] = await Promise.all([
    sb.from("tasks").select(COLS_TAREA).eq("organization_id", org).neq("status", "done").order("position", { ascending: true }).limit(500),
    sb.from("tasks").select(COLS_TAREA).eq("organization_id", org).eq("status", "done").order("completed_at", { ascending: false }).limit(40),
  ]);
  return [...(abiertas.data ?? []), ...(hechas.data ?? [])] as Tarea[];
}

export async function cargarPersonas(sb: SupabaseClient, org: string) {
  const { data } = await sb.rpc("org_people", { p_org: org });
  return (data ?? []) as Persona[];
}

/** Días hasta la fecha límite (negativo = vencida). */
export function diasHasta(fecha: string | null, hoy = new Date()) {
  if (!fecha) return null;
  const a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const [y, m, d] = fecha.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86_400_000);
}

export function textoPlazo(dias: number | null) {
  if (dias === null) return null;
  if (dias < -1) return `Venció hace ${-dias} días`;
  if (dias === -1) return "Venció ayer";
  if (dias === 0) return "Vence hoy";
  if (dias === 1) return "Vence mañana";
  if (dias <= 7) return `Vence en ${dias} días`;
  return null;
}

export function iniciales(nombre: string) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/** «Tú», «Tú y María», «Manuel, María y 1 más». Tú siempre primero. */
export function textoResponsables(ids: string[], nombres: Record<string, string>, yo: string) {
  if (ids.length === 0) return "Sin asignar";
  const orden = [...ids].sort((a, b) => (a === yo ? -1 : b === yo ? 1 : 0));
  const n = orden.map((u) => (u === yo ? "Tú" : nombres[u] ?? "Usuario"));
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} y ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} y ${n[2]}`;
  return `${n[0]}, ${n[1]} y ${n.length - 2} más`;
}

/** Color de avatar estable por persona (para distinguir a dos «M»). */
const TINTES = ["#e6ece2:#4f6b4a", "#f6e6de:#b0532f", "#f5ecdc:#8a5a1c", "#e3e8f7:#3b55b5", "#efe3f1:#7a4583", "#e0eeee:#2f6f6f"];
export function colorAvatar(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [fondo, texto] = TINTES[h % TINTES.length].split(":");
  return { background: fondo, color: texto };
}
