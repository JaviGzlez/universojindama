"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { emailDeUsuario } from "@/lib/usuarios";

export interface EstadoAcceso {
  error?: string;
  aviso?: string;
}

const Credenciales = z.object({
  usuario: z.string().trim().min(1, "Escribe tu usuario."),
  password: z.string().min(1, "Escribe tu contraseña."),
  modo: z.literal("entrar"),
  next: z.string().optional(),
});

function destinoSeguro(next: string | undefined) {
  return next && next.startsWith("/panel") && !next.startsWith("//") ? next : "/panel";
}

export async function acceder(_prev: EstadoAcceso, form: FormData): Promise<EstadoAcceso> {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase todavía no está configurado en este despliegue. Revisa las variables de entorno." };
  }
  const parsed = Credenciales.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  const { usuario, password, next } = parsed.data;
  const email = emailDeUsuario(usuario);
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: traducir(error.message) };
  redirect(destinoSeguro(next));
}

export async function salir() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

function traducir(msg: string) {
  if (/invalid login credentials/i.test(msg)) return "Usuario o contraseña incorrectos.";
  if (/email not confirmed/i.test(msg)) return "Confirma tu correo antes de entrar.";
  if (/already registered/i.test(msg)) return "Ya existe una cuenta con ese correo. Entra con tu contraseña.";
  if (/rate limit/i.test(msg)) return "Demasiados intentos. Espera un momento y vuelve a probar.";
  return msg;
}
