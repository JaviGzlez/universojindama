"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

export function createClient() {
  const env = supabaseEnv();
  if (!env) throw new Error("Supabase no está configurado.");
  return createBrowserClient(env.url, env.key);
}
