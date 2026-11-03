import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/** Cliente de servidor con la sesión del usuario (cookies). RLS aplica siempre. */
export async function createClient() {
  const env = supabaseEnv();
  if (!env) throw new Error("Supabase no está configurado: faltan NEXT_PUBLIC_SUPABASE_URL y la clave pública.");
  const cookieStore = await cookies();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // En Server Components no se pueden escribir cookies; el middleware refresca la sesión.
        }
      },
    },
  });
}

/** Cliente para la API con token Bearer (integraciones). RLS aplica con la identidad del token. */
export function createClientWithToken(token: string) {
  const env = supabaseEnv();
  if (!env) throw new Error("Supabase no está configurado.");
  return createPlainClient(env.url, env.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
