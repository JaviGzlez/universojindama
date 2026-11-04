import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la clave secreta: SOLO para la API de administración de
 * usuarios (crear cuentas, cambiar contraseñas). Nunca para leer o escribir
 * datos del negocio, que pasan siempre por RLS con la sesión del usuario.
 */
export function adminDisponible() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && secretKey());
}

function secretKey() {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = secretKey();
  if (!url || !key) throw new Error("Falta SUPABASE_SECRET_KEY en las variables de entorno del servidor.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
