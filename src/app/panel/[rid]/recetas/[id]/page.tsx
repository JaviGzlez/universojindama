import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Campo, Insignia, Tabla, euro, SinPermiso } from "@/components/ui";
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
  if (!ctx.puedeVer(restaurante, "recetas")) return <SinPermiso apartado="las recetas" />;
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
  const usos = receta.kind === "preparation"
    ? ((await sb.from("recipe_ingredients").select("quantity, unit, recipe_versions!inner(recipe_id, status, recipes!inner(id, name, kind))").eq("sub_recipe_id", id).eq("recipe_versions.status", "active")).data ?? []) as unknown as { quantity: string; unit: string; recipe_versions: { recipes: { id: string; name: string; kind: string } } }[]
    : [];
  const carta = receta.kind === "dish"
    ? ((await sb.from("menu_items").select("id, name, channel_prices(pvp, valid_from, channel:sales_channels(name))").eq("recipe_id", id).eq("status", "active")).data ?? []) as unknown as { id: string; name: string; channel_prices: { pvp: string; valid_from: string; channel: { name: string } | null }[] }[]
    : [];
  const borrador = lista.find((x) => x.status === "draft");
  const elegida = (verId && lista.find((x) => x.id === verId)) || borrador || lista.find((x) => x.status === "active") || lista[0];
  const version = elegida ? await cargarVersion(sb, elegida.id) : null;
  const puede = ctx.puede(restaurante, "recetas");
  const esPlato = receta.kind === "dish";
  const factor = esPlato ? 1 : 1000;
  const numVersion = new Map(lista.map((x) => [x.id, x.number]));

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Link href={`/panel/${rid}/${esPlato ? "recetas" : "elaboraciones"}`} className="text-[13px] font-medium text-niebla hover:text-tinta">← {esPlato ? "Platos" : "Elaboraciones"}</Link>
        {version && (
          <Link href={`/panel/${rid}/recetas/${id}/ficha?v=${version.id}`} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium ring-1 ring-linea hover:bg-crema-2">
            <span aria-hidden="true">⎙</span> Ficha técnica
          </Link>
        )}
      </div>
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
          puedeCrearMaterias={ctx.puede(restaurante, "materias")}
          catalogo={cat}
          impuestosVenta={impuestos.filter((x) => x.kind === "sale").map((x) => ({ id: x.id, name: x.name, rate: x.rate }))}
          decimales={ajustes?.money_decimals ?? 2}
        />
      )}

      <section className="mt-14" aria-labelledby="usos-t">
        <h2 id="usos-t" className="mb-4 text-[24px] font-semibold tracking-[-0.02em]">Dónde se usa</h2>
        {receta.kind === "preparation" ? (
          usos.length === 0 ? (
            <p className="rounded-[22px] border border-dashed border-linea px-6 py-6 text-center text-[14px] text-niebla">Ninguna receta activa usa esta elaboración todavía.</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {usos.map((u, i) => (
                <li key={i}>
                  <Link href={`/panel/${rid}/recetas/${u.recipe_versions.recipes.id}`} className="flex items-center justify-between rounded-2xl bg-white px-5 py-3.5 ring-1 ring-linea hover:bg-crema-2">
                    <span className="font-medium">{u.recipe_versions.recipes.name}</span>
                    <span className="text-[13px] tabular-nums text-grafito">{Number(u.quantity).toLocaleString("es-ES")} {u.unit === "unit" ? "ud" : u.unit}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : carta.length === 0 ? (
          <p className="rounded-[22px] border border-dashed border-linea px-6 py-6 text-center text-[14px] text-niebla">
            Este plato no está en la carta. Añádelo en <Link href={`/panel/${rid}/carta`} className="font-medium text-musgo hover:underline">Carta y canales</Link> para ver su margen por canal.
          </p>
        ) : (
          <ul className="space-y-2">
            {carta.map((m) => {
              const ult = new Map<string, { pvp: string; valid_from: string }>();
              for (const p of [...m.channel_prices].sort((a, b) => b.valid_from.localeCompare(a.valid_from))) {
                const n = p.channel?.name ?? "Canal";
                if (!ult.has(n)) ult.set(n, p);
              }
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3.5 ring-1 ring-linea">
                  <span className="font-medium">{m.name}</span>
                  <span className="flex flex-wrap gap-3 text-[13px] text-grafito">
                    {[...ult.entries()].map(([n, p]) => <span key={n}>{n}: <strong className="tabular-nums">{euro(p.pvp)}</strong></span>)}
                    {ult.size === 0 && <span className="text-niebla">Sin precio</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
