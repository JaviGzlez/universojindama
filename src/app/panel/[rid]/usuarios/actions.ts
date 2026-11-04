"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { getRestaurante } from "@/lib/contexto";
import { adminDisponible, createAdminClient } from "@/lib/supabase/admin";
import { emailDeUsuario, normalizarUsuario, PATRON_USUARIO } from "@/lib/usuarios";

const ROLES = ["admin", "kitchen", "purchasing", "accounting", "viewer"] as const;
const t = () => Date.now();
const fallo = (mensaje: string, errores?: Record<string, string>): ResultadoAccion => ({ ok: false, mensaje, errores, t: t() });

/** Solo el propietario de la organización del restaurante puede gestionar usuarios. */
async function comoPropietario(rid: string) {
  const r = await getRestaurante(rid);
  if (!r || !r.ctx.esPropietario(r.restaurante.organization_id)) return null;
  return { ...r, org: r.restaurante.organization_id };
}

function alcance(form: FormData): { restaurantes: string[] | null; error?: string } {
  if (form.get("alcance") === "todos") return { restaurantes: null };
  const ids = form.getAll("restaurantes").map(String).filter(Boolean);
  if (ids.length === 0) return { restaurantes: null, error: "Elige al menos un restaurante o «Todos»." };
  return { restaurantes: ids };
}

function traducir(msg: string) {
  if (/already been registered|already registered|exists/i.test(msg)) return "Ya existe ese nombre de usuario.";
  if (/password/i.test(msg) && /weak|short|characters/i.test(msg)) return "La contraseña es demasiado débil (mínimo 8 caracteres).";
  return msg;
}

const Nuevo = z.object({
  rid: z.string().uuid(),
  nombre: z.string().trim().min(1, "Escribe un nombre").max(60),
  usuario: z.string().transform(normalizarUsuario).refine((v) => PATRON_USUARIO.test(v), "Usa de 2 a 30 letras o números, sin espacios (puede llevar . _ -)"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
  rol: z.enum(ROLES),
});

export async function crearUsuario(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Nuevo.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return fallo("Revisa los campos marcados.", Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  }
  const d = parsed.data;
  const p = await comoPropietario(d.rid);
  if (!p) return fallo("Solo el propietario puede crear usuarios.");
  if (!adminDisponible()) return fallo("Falta configurar SUPABASE_SECRET_KEY en Vercel para poder crear usuarios.");
  const a = alcance(form);
  if (a.error) return fallo(a.error);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: emailDeUsuario(d.usuario),
    password: d.password,
    email_confirm: true, // la cuenta queda activa sin correo de confirmación
    user_metadata: { display_name: d.nombre },
  });
  if (error || !data.user) return fallo(traducir(error?.message ?? "No se ha podido crear la cuenta."));

  // El acceso se asigna con la sesión del propietario: RLS + auditoría con su nombre
  const { error: e2 } = await p.ctx.supabase.rpc("set_member_access", {
    p_org: p.org, p_user: data.user.id, p_role: d.rol, p_restaurants: a.restaurantes,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id); // no dejar cuentas a medias
    return fallo(`No se ha podido asignar el acceso: ${e2.message}`);
  }
  revalidatePath(`/panel/${d.rid}/usuarios`);
  return { ok: true, mensaje: `${d.nombre} ya puede entrar con el usuario «${d.usuario}».`, t: t() };
}

const Acceso = z.object({ rid: z.string().uuid(), user_id: z.string().uuid(), rol: z.enum(ROLES) });

export async function cambiarAcceso(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Acceso.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo("Datos no válidos.");
  const d = parsed.data;
  const p = await comoPropietario(d.rid);
  if (!p) return fallo("Solo el propietario puede cambiar accesos.");
  const a = alcance(form);
  if (a.error) return fallo(a.error);
  const { error } = await p.ctx.supabase.rpc("set_member_access", {
    p_org: p.org, p_user: d.user_id, p_role: d.rol, p_restaurants: a.restaurantes,
  });
  if (error) return fallo(error.message);
  revalidatePath(`/panel/${d.rid}/usuarios`);
  return { ok: true, mensaje: "Acceso actualizado.", t: t() };
}

const Clave = z.object({
  rid: z.string().uuid(), user_id: z.string().uuid(),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
});

export async function cambiarContrasena(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Clave.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo(parsed.error.issues[0]?.message ?? "Datos no válidos.");
  const d = parsed.data;
  const p = await comoPropietario(d.rid);
  if (!p) return fallo("Solo el propietario puede cambiar contraseñas.");
  if (!adminDisponible()) return fallo("Falta configurar SUPABASE_SECRET_KEY en Vercel.");
  // Solo usuarios de su organización
  const { data: miembro } = await p.ctx.supabase
    .from("memberships").select("user_id").eq("organization_id", p.org).eq("user_id", d.user_id).limit(1);
  if (!miembro?.length && d.user_id !== p.ctx.user.id) return fallo("Ese usuario no pertenece a tu organización.");
  const { error } = await createAdminClient().auth.admin.updateUserById(d.user_id, { password: d.password });
  if (error) return fallo(traducir(error.message));
  return { ok: true, mensaje: "Contraseña cambiada.", t: t() };
}

const Nombre = z.object({ rid: z.string().uuid(), user_id: z.string().uuid(), nombre: z.string().trim().min(1).max(60) });

export async function cambiarNombre(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Nombre.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo("Escribe un nombre.");
  const d = parsed.data;
  const r = await getRestaurante(d.rid);
  if (!r) return fallo("Sin acceso.");
  const { data, error } = await r.ctx.supabase.from("profiles").update({ display_name: d.nombre }).eq("user_id", d.user_id).select("user_id");
  if (error) return fallo(error.message);
  if (!data?.length) return fallo("No tienes permiso para cambiar este nombre.");
  revalidatePath(`/panel/${d.rid}`, "layout");
  return { ok: true, mensaje: "Nombre guardado.", t: t() };
}

const Quitar = z.object({ rid: z.string().uuid(), user_id: z.string().uuid() });

export async function quitarAcceso(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Quitar.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo("Datos no válidos.");
  const d = parsed.data;
  const p = await comoPropietario(d.rid);
  if (!p) return fallo("Solo el propietario puede quitar accesos.");
  const { error } = await p.ctx.supabase.rpc("remove_member", { p_org: p.org, p_user: d.user_id });
  if (error) return fallo(error.message);
  revalidatePath(`/panel/${d.rid}/usuarios`);
  return { ok: true, mensaje: "Acceso retirado.", t: t() };
}
