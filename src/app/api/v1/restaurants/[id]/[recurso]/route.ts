import { api, ApiError, body, dbError, pagina, paginacion } from "@/lib/api/http";
import { CATALOGOS, esRecurso } from "@/lib/api/catalogos";

type P = { id: string; recurso: string };

/**
 * GET/POST /api/v1/restaurants/{id}/{ingredients|equipment|labor-profiles|energy-tariffs|tax-rates|consumables}
 */
export const GET = api<P>(async ({ supabase, request }, { id, recurso }) => {
  if (!esRecurso(recurso)) throw new ApiError(404, "not_found", "Recurso desconocido.");
  const cfg = CATALOGOS[recurso];
  const { limit, cursor } = paginacion(request);
  const estado = request.nextUrl.searchParams.get("status") ?? "active";

  const tabla: string = cfg.tabla;
  const columnas: string = cfg.columnas;
  let q = supabase.from(tabla).select(columnas).order("id").limit(limit + 1);
  q = cfg.incluyeCompartidos ? q.or(`restaurant_id.eq.${id},restaurant_id.is.null`) : q.eq("restaurant_id", id);
  if (estado !== "all") q = q.eq("status", estado);
  if (cursor) q = q.gt("id", cursor);

  // Comprueba acceso al restaurante para no devolver solo compartidos a un ajeno
  const { data: rest, error: e0 } = await supabase.from("restaurants").select("id, organization_id").eq("id", id).maybeSingle();
  if (e0) dbError(e0);
  if (!rest) throw new ApiError(404, "not_found", "Restaurante no encontrado.");
  if (cfg.incluyeCompartidos) q = q.eq("organization_id", rest.organization_id);

  const { data, error } = await q;
  if (error) dbError(error);
  return pagina((data ?? []) as unknown as { id: string }[], limit);
});

export const POST = api<P>(async ({ supabase, request }, { id, recurso }) => {
  if (!esRecurso(recurso)) throw new ApiError(404, "not_found", "Recurso desconocido.");
  const cfg = CATALOGOS[recurso];
  const input = (await body(request, cfg.crear)) as Record<string, unknown>;

  const { data: rest, error: e0 } = await supabase.from("restaurants").select("id, organization_id").eq("id", id).maybeSingle();
  if (e0) dbError(e0);
  if (!rest) throw new ApiError(404, "not_found", "Restaurante no encontrado.");

  let fila: Record<string, unknown> = { ...input, restaurant_id: id };
  if (recurso === "ingredients") {
    const { shared, ...resto } = input as { shared?: boolean };
    fila = { ...resto, organization_id: rest.organization_id, restaurant_id: shared ? null : id };
  }
  const tabla: string = cfg.tabla;
  const columnas: string = cfg.columnas;
  const { data, error } = await supabase.from(tabla).insert(fila).select(columnas).single();
  if (error) dbError(error);
  return Response.json({ data }, { status: 201 });
});
