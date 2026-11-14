"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { getContexto } from "@/lib/contexto";
import { ESTADOS, PRIORIDADES, type Estado } from "@/lib/tareas";

const t = () => Date.now();
const fallo = (mensaje: string, errores?: Record<string, string>): ResultadoAccion => ({ ok: false, mensaje, errores, t: t() });

function traducir(msg: string) {
  if (/Solo quien la creó/.test(msg)) return "Solo quien la creó, quien la tiene asignada o un administrador puede cambiar esta tarea.";
  if (/no pertenece al grupo/.test(msg)) return msg.replace(/^.*?(Esa persona|Algún restaurante)/, "$1") + ".";
  if (/row-level security|permission/i.test(msg)) return "No tienes permiso para hacer esto.";
  return "No se ha podido guardar. Inténtalo de nuevo.";
}

function refrescar(id?: string) {
  revalidatePath("/panel/tareas");
  if (id) revalidatePath(`/panel/tareas/${id}`);
  revalidatePath("/panel", "layout");
}

const fecha = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined));
const Datos = z.object({
  title: z.string().trim().min(1, "Escribe qué hay que hacer.").max(200, "Máximo 200 caracteres."),
  description: z.string().trim().max(4000, "Máximo 4000 caracteres.").optional(),
  priority: z.enum(PRIORIDADES).default("normal"),
  due_date: fecha,
  assignee_id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  status: z.enum(ESTADOS).default("pending"),
});

function leer(form: FormData) {
  const r = Datos.safeParse({
    title: form.get("title") ?? "",
    description: form.get("description") ?? undefined,
    priority: form.get("priority") || undefined,
    due_date: form.get("due_date") ?? undefined,
    assignee_id: form.get("assignee_id") ?? undefined,
    status: form.get("status") || undefined,
  });
  const restaurantes = form.getAll("restaurant_ids").map(String).filter(Boolean);
  return { r, restaurantes };
}

export async function crearTarea(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const ctx = await getContexto();
  const org = ctx?.restaurants[0]?.organization_id;
  if (!ctx || !org) return fallo("Sesión caducada.");
  const { r, restaurantes } = leer(form);
  if (!r.success) return fallo("Revisa los campos.", Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = r.data;
  const { error } = await ctx.supabase.from("tasks").insert({
    organization_id: org,
    title: d.title,
    description: d.description || null,
    priority: d.priority,
    due_date: d.due_date ?? null,
    assignee_id: d.assignee_id ?? null,
    status: d.status,
    restaurant_ids: restaurantes,
  });
  if (error) return fallo(traducir(error.message));
  refrescar();
  return { ok: true, mensaje: d.assignee_id ? "Tarea creada y asignada" : "Tarea creada (sin asignar)", t: t() };
}

export async function editarTarea(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const ctx = await getContexto();
  if (!ctx) return fallo("Sesión caducada.");
  const id = String(form.get("id") ?? "");
  const version = Number(form.get("version"));
  const { r, restaurantes } = leer(form);
  if (!r.success) return fallo("Revisa los campos.", Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = r.data;
  const { data, error } = await ctx.supabase.from("tasks").update({
    title: d.title,
    description: d.description || null,
    priority: d.priority,
    due_date: d.due_date ?? null,
    assignee_id: d.assignee_id ?? null,
    status: d.status,
    restaurant_ids: restaurantes,
  }).eq("id", id).eq("version", version).select("id");
  if (error) return fallo(traducir(error.message));
  if (!data?.length) return fallo("Alguien ha cambiado esta tarea mientras la editabas. Recarga la página.");
  refrescar(id);
  return { ok: true, mensaje: "Cambios guardados", t: t() };
}

/** Cambio rápido desde el tablero: estado, «me la quedo» o soltarla. Devuelve error legible. */
export async function cambiarTarea(id: string, cambio: { status?: Estado; asignarme?: boolean; soltar?: boolean; position?: number }) {
  const ctx = await getContexto();
  if (!ctx) return { ok: false, mensaje: "Sesión caducada." };
  const upd: Record<string, unknown> = {};
  if (cambio.status) {
    if (!ESTADOS.includes(cambio.status)) return { ok: false, mensaje: "Estado no válido." };
    upd.status = cambio.status;
  }
  if (cambio.asignarme) upd.assignee_id = ctx.user.id;
  if (cambio.soltar) upd.assignee_id = null;
  if (typeof cambio.position === "number" && Number.isFinite(cambio.position)) upd.position = cambio.position;
  if (Object.keys(upd).length === 0) return { ok: true, mensaje: "" };
  let q = ctx.supabase.from("tasks").update(upd).eq("id", id);
  // «Me la quedo» solo si sigue libre: si otro se adelantó, no se pisa
  if (cambio.asignarme) q = q.is("assignee_id", null);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, mensaje: traducir(error.message) };
  if (!data?.length) return { ok: false, mensaje: cambio.asignarme ? "Otra persona se la ha quedado antes." : "No se ha encontrado la tarea." };
  refrescar(id);
  return { ok: true, mensaje: "" };
}

export async function borrarTarea(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const ctx = await getContexto();
  if (!ctx) return fallo("Sesión caducada.");
  const id = String(form.get("id") ?? "");
  const { data, error } = await ctx.supabase.from("tasks").delete().eq("id", id).select("id");
  if (error) return fallo(traducir(error.message));
  if (!data?.length) return fallo("Solo quien la creó o un administrador puede borrarla.");
  refrescar();
  redirect("/panel/tareas");
}

export async function comentarTarea(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const ctx = await getContexto();
  if (!ctx) return fallo("Sesión caducada.");
  const id = String(form.get("task_id") ?? "");
  const body = String(form.get("body") ?? "").trim();
  if (!body) return fallo("Escribe un comentario.");
  if (body.length > 2000) return fallo("Máximo 2000 caracteres.");
  const { error } = await ctx.supabase.from("task_comments").insert({ task_id: id, body });
  if (error) return fallo(traducir(error.message));
  revalidatePath(`/panel/tareas/${id}`);
  return { ok: true, mensaje: "Comentario añadido", t: t() };
}
