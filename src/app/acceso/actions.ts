"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface EstadoAcceso {
  error?: string;
  aviso?: string;
}

const Credenciales = z.object({
  email: z.string().trim().email("Introduce un correo válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
  modo: z.enum(["entrar", "registro"]),
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
  const { email, password, modo, next } = parsed.data;
  const supabase = await createClient();

  if (modo === "registro") {
    const h = await headers();
    const origin = h.get("origin") ?? `https://${h.get("host")}`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback?next=/panel` },
    });
    if (error) return { error: traducir(error.message) };
    if (!data.session) {
      return { aviso: "Te hemos enviado un correo para confirmar la cuenta. Ábrelo desde este dispositivo y vuelve aquí." };
    }
    redirect("/panel");
  }

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
  if (/invalid login credentials/i.test(msg)) return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(msg)) return "Confirma tu correo antes de entrar.";
  if (/already registered/i.test(msg)) return "Ya existe una cuenta con ese correo. Entra con tu contraseña.";
  if (/rate limit/i.test(msg)) return "Demasiados intentos. Espera un momento y vuelve a probar.";
  return msg;
}
