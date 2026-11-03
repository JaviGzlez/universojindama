import { z } from "zod";
import { api, ApiError, body, dbError, ifMatch } from "@/lib/api/http";
import { CATALOGOS } from "@/lib/api/catalogos";

const COLS = CATALOGOS.ingredients.columnas;

export const GET = api<{ id: string }>(async ({ supabase }, { id }) => {
  const { data, error } = await supabase.from("ingredients").select(COLS).eq("id", id).single();
  if (error) dbError(error);
  return Response.json({ data }, { headers: { etag: `"${(data as { version: number }).version}"` } });
});

const Patch = CATALOGOS.ingredients.crear.omit({ shared: true }).partial().extend({
  status: z.enum(["active", "archived"]).optional(),
}).strict();

/** Requiere If-Match con la versión actual. Las bajas se hacen archivando. */
export const PATCH = api<{ id: string }>(async ({ supabase, request }, { id }) => {
  const version = ifMatch(request);
  const input = await body(request, Patch);
  const { data, error } = await supabase.from("ingredients").update(input).eq("id", id).eq("version", version).select(COLS);
  if (error) dbError(error);
  if (!data || data.length === 0) {
    throw new ApiError(412, "precondition_failed", "La versión no coincide o no tienes permiso. Vuelve a leer el recurso.");
  }
  const fila = data[0] as unknown as { version: number };
  return Response.json({ data: fila }, { headers: { etag: `"${fila.version}"` } });
});
