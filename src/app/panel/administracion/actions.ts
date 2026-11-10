"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ResultadoAccion } from "@/components/formulario-accion";
import { AREAS, getContexto, type Area, type Nivel } from "@/lib/contexto";
import { adminDisponible, createAdminClient } from "@/lib/supabase/admin";
import { emailDeUsuario, normalizarUsuario, PATRON_USUARIO } from "@/lib/usuarios";

const ROLES = ["admin", "kitchen", "purchasing", "accounting", "viewer"] as const;
const t = () => Date.now();
const fallo = (mensaje: string, errores?: Record<string, string>): ResultadoAccion => ({ ok: false, mensaje, errores, t: t() });

/** Solo el propietario de la organización gestiona el equipo. */
async function comoPropietario(org: string) {
  const ctx = await getContexto();
  if (!ctx || !ctx.esPropietario(org)) return null;
  return ctx;
}

function alcance(form: FormData): { restaurantes: string[] | null; error?: string } {
  if (form.get("alcance") === "todos") return { restaurantes: null };
  const ids = form.getAll("restaurantes").map(String).filter(Boolean);
  if (ids.length === 0) return { restaurantes: null, error: "Elige al menos un restaurante o «Todos»." };
  return { restaurantes: ids };
}

/** Casillas del formulario → { recetas: "write", compras: "read", … } */
function permisos(form: FormData): Record<Area, Nivel> {
  const out = {} as Record<Area, Nivel>;
  for (const a of AREAS) {
    const v = String(form.get(`perm_${a}`) ?? "none");
    out[a] = v === "write" || v === "read" ? v : "none";
  }
  return out;
}

function traducir(msg: string) {
  if (/already been registered|already registered|exists/i.test(msg)) return "Ya existe ese nombre de usuario.";
  if (/password/i.test(msg) && /weak|short|characters/i.test(msg)) return "La contraseña es demasiado débil (mínimo 8 caracteres).";
  return msg;
}

const Nuevo = z.object({
  org: z.string().uuid(),
  nombre: z.string().trim().min(1, "Escribe un nombre").max(60),
  usuario: z.string().transform(normalizarUsuario).refine((v) => PATRON_USUARIO.test(v), "Usa de 2 a 30 letras o números, sin espacios (puede llevar . _ -)"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
  rol: z.enum(ROLES),
});

export async function crearUsuario(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Nuevo.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo("Revisa los campos marcados.", Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;
  const ctx = await comoPropietario(d.org);
  if (!ctx) return fallo("Solo el propietario puede crear usuarios.");
  if (!adminDisponible()) return fallo("Falta configurar SUPABASE_SECRET_KEY en Vercel para poder crear usuarios.");
  const a = alcance(form);
  if (a.error) return fallo(a.error);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: emailDeUsuario(d.usuario), password: d.password, email_confirm: true, user_metadata: { display_name: d.nombre },
  });
  if (error || !data.user) return fallo(traducir(error?.message ?? "No se ha podido crear la cuenta."));
  const { error: e2 } = await ctx.supabase.rpc("set_member_access", {
    p_org: d.org, p_user: data.user.id, p_role: d.rol, p_restaurants: a.restaurantes, p_permissions: d.rol === "admin" ? null : permisos(form),
  });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id); // no dejar cuentas a medias
    return fallo(`No se ha podido asignar el acceso: ${e2.message}`);
  }
  revalidatePath("/panel/administracion");
  return { ok: true, mensaje: `${d.nombre} ya puede entrar con el usuario «${d.usuario}».`, t: t() };
}

const Acceso = z.object({ org: z.string().uuid(), user_id: z.string().uuid(), rol: z.enum(ROLES) });

export async function cambiarAcceso(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Acceso.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo("Datos no válidos.");
  const d = parsed.data;
  const ctx = await comoPropietario(d.org);
  if (!ctx) return fallo("Solo el propietario puede cambiar accesos.");
  const a = alcance(form);
  if (a.error) return fallo(a.error);
  const { error } = await ctx.supabase.rpc("set_member_access", {
    p_org: d.org, p_user: d.user_id, p_role: d.rol, p_restaurants: a.restaurantes, p_permissions: d.rol === "admin" ? null : permisos(form),
  });
  if (error) return fallo(error.message);
  revalidatePath("/panel/administracion");
  return { ok: true, mensaje: "Acceso y permisos guardados.", t: t() };
}

const Clave = z.object({ org: z.string().uuid(), user_id: z.string().uuid(), password: z.string().min(8, "Mínimo 8 caracteres").max(72) });

export async function cambiarContrasena(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Clave.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo(parsed.error.issues[0]?.message ?? "Datos no válidos.");
  const d = parsed.data;
  const ctx = await comoPropietario(d.org);
  if (!ctx) return fallo("Solo el propietario puede cambiar contraseñas.");
  if (!adminDisponible()) return fallo("Falta configurar SUPABASE_SECRET_KEY en Vercel.");
  const { data: miembro } = await ctx.supabase.from("memberships").select("user_id").eq("organization_id", d.org).eq("user_id", d.user_id).limit(1);
  if (!miembro?.length && d.user_id !== ctx.user.id) return fallo("Ese usuario no pertenece a tu organización.");
  const { error } = await createAdminClient().auth.admin.updateUserById(d.user_id, { password: d.password });
  if (error) return fallo(traducir(error.message));
  return { ok: true, mensaje: "Contraseña cambiada.", t: t() };
}

const Nombre = z.object({ user_id: z.string().uuid(), nombre: z.string().trim().min(1).max(60) });

export async function cambiarNombre(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Nombre.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo("Escribe un nombre.");
  const ctx = await getContexto();
  if (!ctx) return fallo("Sin acceso.");
  const { data, error } = await ctx.supabase.from("profiles").update({ display_name: parsed.data.nombre }).eq("user_id", parsed.data.user_id).select("user_id");
  if (error) return fallo(error.message);
  if (!data?.length) return fallo("No tienes permiso para cambiar este nombre.");
  revalidatePath("/panel", "layout");
  return { ok: true, mensaje: "Nombre guardado.", t: t() };
}

const Quitar = z.object({ org: z.string().uuid(), user_id: z.string().uuid() });

export async function quitarAcceso(_: ResultadoAccion, form: FormData): Promise<ResultadoAccion> {
  const parsed = Quitar.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fallo("Datos no válidos.");
  const ctx = await comoPropietario(parsed.data.org);
  if (!ctx) return fallo("Solo el propietario puede quitar accesos.");
  const { error } = await ctx.supabase.rpc("remove_member", { p_org: parsed.data.org, p_user: parsed.data.user_id });
  if (error) return fallo(error.message);
  revalidatePath("/panel/administracion");
  return { ok: true, mensaje: "Acceso retirado.", t: t() };
}
