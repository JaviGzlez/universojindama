import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Campo, Insignia, Tabla, euro } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarAjustes, cargarImpuestos } from "@/lib/datos";
import { cargarCatalogo, cargarVersion } from "@/lib/recetas";
import { archivarReceta, renombrarReceta } from "../actions";
import { BotonGuardarCalculo } from "./guardar-calculo";
import { EditorReceta } from "./editor";

export const metadata = { title: "Receta" };

const MOTIVO = { manual: "Guardado manual", activation: "Activación", price_change: "Cambio de precio", recalculation: "Recálculo" } as const;
const ESTADO = { complete: ["Completo", "ok"], estimated: ["Estimado", "estimado"], incomplete: ["Incompleto", "pendiente"] } as const;

export default async function RecetaDetalle({ params, searchParams }: { params: Promise<{ rid: string; id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { rid, id } = await params;
  const { v: verId } = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;

  const { data: receta } = await sb.from("recipes").select("id, restaurant_id, name, kind, category, active_version_id, status, version").eq("id", id).eq("restaurant_id", rid).maybeSingle();
  if (!receta) notFound();
  const [{ data: versiones }, { cat }, impuestos, ajustes, { data: historial }] = await Promise.all([
    sb.from("recipe_versions").select("id, number, status, created_at, activated_at").eq("recipe_id", id).order("number", { ascending: false }),
    cargarCatalogo(sb, rid, restaurante.organization_id),
    cargarImpuestos(sb, rid),
    cargarAjustes(sb, rid),
    sb.from("cost_snapshots").select("id, created_at, reason, status, direct_per_unit, full_per_unit, recipe_version_id").eq("recipe_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  const lista = versiones ?? [];
  const borrador = lista.find((x) => x.status === "draft");
  const elegida = (verId && lista.find((x) => x.id === verId)) || borrador || lista.find((x) => x.status === "active") || lista[0];
  const version = elegida ? await cargarVersion(sb, elegida.id) : null;
  const puede = ctx.puede(restaurante, "equipos");
  const esPlato = receta.kind === "dish";
  const factor = esPlato ? 1 : 1000;
  const numVersion = new Map(lista.map((x) => [x.id, x.number]));

  return (
    <>
      <Link href={`/panel/${rid}/recetas`} className="text-[13px] font-medium text-niebla hover:text-tinta">← Recetas</Link>
      <div className="mb-8 mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-niebla">{esPlato ? "Plato de venta" : "Elaboración intermedia"}{receta.category ? ` · ${receta.category}` : ""}</p>
          <h1 className="mt-1 text-[36px] font-semibold leading-tight tracking-[-0.03em] md:text-[44px]">{receta.name}</h1>
        </div>
        {puede && (
          <details className="group">
            <summary className="cursor-pointer list-none text-[13px] font-medium text-musgo">Nombre, categoría y archivo</summary>
            <div className="mt-3 w-[320px] rounded-2xl bg-white p-4 ring-1 ring-linea">
              <FormularioAccion action={renombrarReceta} boton="Guardar" limpiar={false}>
                <input type="hidden" name="rid" value={rid} />
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="version" value={receta.version} />
                <div className="space-y-3">
                  <Campo label="Nombre" name="name" defaultValue={receta.name} required />
                  <Campo label="Categoría" name="category" defaultValue={receta.category ?? ""} />
                </div>
              </FormularioAccion>
              <div className="mt-4 border-t border-linea pt-3">
                <AccionRapida action={archivarReceta} etiqueta="Archivar receta" confirmar={`¿Archivar «${receta.name}»? Su histórico se conserva.`} campos={{ rid, id }} />
              </div>
            </div>
          </details>
        )}
      </div>

      {lista.length > 1 && (
        <nav className="mb-5 flex flex-wrap gap-2" aria-label="Versiones">
          {lista.map((x) => (
            <Link key={x.id} href={`/panel/${rid}/recetas/${id}?v=${x.id}`} aria-current={x.id === elegida?.id ? "true" : undefined}
              className={`inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium ${x.id === elegida?.id ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea hover:bg-crema-2"}`}>
              v{x.number}
              <span className={x.id === elegida?.id ? "text-crema/60" : "text-niebla"}>{x.status === "active" ? "activa" : x.status === "draft" ? "borrador" : new Date(x.activated_at ?? x.created_at).toLocaleDateString("es-ES")}</span>
            </Link>
          ))}
        </nav>
      )}

      {version && (
        <EditorReceta
          key={`${version.id}-${version.version}`}
          rid={rid}
          recipeId={id}
          kind={receta.kind}
          version={version}
          hayActiva={Boolean(receta.active_version_id)}
          puedeEditar={puede}
          catalogo={cat}
          impuestosVenta={impuestos.filter((x) => x.kind === "sale").map((x) => ({ id: x.id, name: x.name, rate: x.rate }))}
          decimales={ajustes?.money_decimals ?? 2}
        />
      )}

      <section className="mt-14" aria-labelledby="hist-t">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="hist-t" className="text-[24px] font-semibold tracking-[-0.02em]">Histórico de costes</h2>
          {puede && receta.active_version_id && <BotonGuardarCalculo rid={rid} recipeId={id} />}
        </div>
        {(historial?.length ?? 0) === 0 ? (
          <p className="rounded-[22px] border border-dashed border-linea px-6 py-8 text-center text-[14px] text-niebla">
            Al activar una versión o cambiar un precio se guarda aquí una fotografía del coste. Nunca se reescribe.
          </p>
        ) : (
          <Tabla cabeceras={["Fecha", "Motivo", "Versión", "Estado", esPlato ? "Coste directo / ración" : "Coste / kg·l·ud", esPlato ? "Coste completo" : ""]}>
            {historial!.map((h) => {
              const e = ESTADO[h.status as keyof typeof ESTADO];
              return (
                <tr key={h.id}>
                  <td className="px-5 py-3 text-grafito">{new Date(h.created_at).toLocaleString("es-ES", { timeZone: restaurante.timezone, dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-5 py-3 text-grafito">{MOTIVO[h.reason as keyof typeof MOTIVO] ?? h.reason}</td>
                  <td className="px-5 py-3 text-grafito">v{numVersion.get(h.recipe_version_id) ?? "?"}</td>
                  <td className="px-5 py-3"><Insignia tono={e[1]}>{e[0]}</Insignia></td>
                  <td className="px-5 py-3 font-medium tabular-nums">{h.direct_per_unit ? euro(Number(h.direct_per_unit) * factor, 3) : "—"}</td>
                  <td className="px-5 py-3 tabular-nums text-grafito">{esPlato && h.full_per_unit ? euro(h.full_per_unit, 3) : ""}</td>
                </tr>
              );
            })}
          </Tabla>
        )}
      </section>
    </>
  );
}
