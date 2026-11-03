import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { createClient, createClientWithToken } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface ApiContext {
  supabase: SupabaseClient;
  user: User;
  requestId: string;
  request: NextRequest;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function jsonError(status: number, code: string, message: string, requestId: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) }, request_id: requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}

/**
 * Envoltorio común: request_id, autenticación (cookie de sesión o Bearer),
 * errores estructurados. La autorización la aplica RLS en cada consulta.
 */
export function api<P>(handler: (ctx: ApiContext, params: P) => Promise<Response | unknown>) {
  return async (request: NextRequest, route: { params: Promise<P> }) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    try {
      if (!isSupabaseConfigured()) throw new ApiError(503, "not_configured", "Supabase no está configurado.");
      const auth = request.headers.get("authorization");
      const token = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
      const supabase = token ? createClientWithToken(token) : await createClient();
      const { data, error } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
      if (error || !data.user) throw new ApiError(401, "unauthenticated", "Se requiere autenticación.");
      const params = await route.params;
      const out = await handler({ supabase, user: data.user, requestId, request }, params);
      if (out instanceof Response) {
        out.headers.set("x-request-id", requestId);
        return out;
      }
      return NextResponse.json(out, { headers: { "x-request-id": requestId } });
    } catch (e) {
      if (e instanceof ApiError) return jsonError(e.status, e.code, e.message, requestId, e.details);
      if (e instanceof ZodError) return jsonError(422, "validation_failed", "Datos no válidos.", requestId, e.issues);
      console.error(`[${requestId}]`, e);
      return jsonError(500, "internal_error", "Error interno.", requestId);
    }
  };
}

export async function body<T extends ZodTypeAny>(request: NextRequest, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "El cuerpo debe ser JSON válido.");
  }
  return schema.parse(raw);
}

/** Traduce errores de PostgREST a errores de API estables. */
export function dbError(error: { code?: string; message: string }): never {
  if (error.code === "42501" || /row-level security/i.test(error.message)) throw new ApiError(403, "forbidden", "No tienes permiso para esta operación.");
  if (error.code === "23505") throw new ApiError(409, "conflict", "El recurso ya existe.");
  if (error.code === "23514" || error.code === "23502" || error.code === "22P02") throw new ApiError(422, "constraint_violation", error.message);
  if (error.code === "PGRST116") throw new ApiError(404, "not_found", "Recurso no encontrado.");
  throw new ApiError(500, "database_error", "Error de base de datos.");
}

/** Paginación por cursor sobre id (orden estable). */
export function paginacion(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), 200);
  const cursor = sp.get("cursor");
  return { limit, cursor };
}

export function pagina<T extends { id: string }>(rows: T[], limit: number) {
  const hayMas = rows.length > limit;
  const data = hayMas ? rows.slice(0, limit) : rows;
  return { data, next_cursor: hayMas ? data[data.length - 1].id : null };
}

/** If-Match: "<version>" para control de concurrencia optimista. */
export function ifMatch(request: NextRequest): number {
  const h = request.headers.get("if-match");
  const v = h ? Number(h.replace(/W\//, "").replace(/"/g, "")) : NaN;
  if (!Number.isInteger(v)) throw new ApiError(428, "precondition_required", "Envía la cabecera If-Match con la versión actual del recurso.");
  return v;
}
