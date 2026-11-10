import Link from "next/link";
import { notFound } from "next/navigation";
import { Mundo, mundoDeSlug } from "@/components/mundo";
import { SinPermiso, euro } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { calcularVersion, cargarCatalogo, cargarVersion, editable, type Receta } from "@/lib/recetas";
import { alergenosDe } from "@/lib/recetas-entrada";
import { BotonImprimir } from "./imprimir";

export const metadata = { title: "Ficha técnica" };

const U = { g: "g", kg: "kg", ml: "ml", l: "l", unit: "ud" } as const;

export default async function Ficha({ params, searchParams }: { params: Promise<{ rid: string; id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { rid, id } = await params;
  const { v: vid } = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "recetas")) return <SinPermiso apartado="las recetas" />;
  const sb = ctx.supabase;
  const { data: rec } = await sb.from("recipes").select("id, restaurant_id, name, kind, category, active_version_id, status, version").eq("id", id).eq("restaurant_id", rid).maybeSingle();
  if (!rec) notFound();
  const receta = rec as Receta;
  const v = await cargarVersion(sb, vid ?? receta.active_version_id ?? "");
  if (!v) notFound();
  const { cat } = await cargarCatalogo(sb, rid, restaurante.organization_id);
  const { result } = calcularVersion(v, receta, cat);
  const esPlato = receta.kind === "dish";
  const alergenos = alergenosDe(editable(v, receta.kind), cat, v.extra_allergens);
  const total = (Number(v.prep_minutes) || 0) + (Number(v.cook_minutes) || 0) + (Number(v.rest_minutes) || 0);
  const lineasCoste = result.lines.filter((l) => l.group === "ingredients");
  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}` : `${m} min`);

  return (
    <article className="mx-auto max-w-4xl rounded-[28px] bg-white p-8 ring-1 ring-linea print:max-w-none print:rounded-none print:p-0 print:ring-0 md:p-12">
      <div className="no-imprimir mb-8 flex items-center justify-between">
        <Link href={`/panel/${rid}/recetas/${id}`} className="text-[13px] font-medium text-niebla hover:text-tinta">← Volver a la receta</Link>
        <BotonImprimir />
      </div>

      <header className="flex items-start justify-between gap-6 border-b border-linea pb-6">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-niebla">
            Ficha técnica · {esPlato ? "Plato" : "Elaboración"}{receta.category ? ` · ${receta.category}` : ""}
          </p>
          <h1 className="mt-2 text-[34px] font-semibold leading-tight tracking-[-0.03em]">{receta.name}</h1>
          <p className="mt-1 text-[13px] text-niebla">
            {restaurante.name} · versión {v.number}{v.status === "active" ? " (activa)" : v.status === "draft" ? " (borrador)" : ""} · {new Date().toLocaleDateString("es-ES", { dateStyle: "long" })}
          </p>
        </div>
        <Mundo id={mundoDeSlug(restaurante.slug)} size={56} />
      </header>

      <dl className="grid grid-cols-2 gap-4 border-b border-linea py-6 text-[14px] sm:grid-cols-4">
        <div><dt className="text-niebla">{esPlato ? "Raciones" : "Produce"}</dt><dd className="mt-0.5 text-[18px] font-semibold">{esPlato ? (v.portions ? Number(v.portions) : "—") : v.yield_quantity ? `${Number(v.yield_quantity).toLocaleString("es-ES")} ${U[v.yield_unit ?? "g"]}` : "—"}</dd></div>
        <div><dt className="text-niebla">Tiempo total</dt><dd className="mt-0.5 text-[18px] font-semibold">{total ? fmtMin(total) : "—"}</dd></div>
        <div><dt className="text-niebla">Vida útil</dt><dd className="mt-0.5 text-[18px] font-semibold">{v.shelf_life_hours ? `${Number(v.shelf_life_hours)} h` : "—"}</dd></div>
        <div><dt className="text-niebla">{esPlato ? "Coste / ración" : "Coste / kg·l·ud"}</dt>
          <dd className="mt-0.5 text-[18px] font-semibold">{result.costs.direct_per_portion ? euro(Number(result.costs.direct_per_portion) * (esPlato ? 1 : v.yield_unit === "unit" ? 1 : 1000), 2) : "—"}</dd></div>
      </dl>

      <section className="border-b border-linea py-6">
        <h2 className="mb-3 text-[15px] font-semibold uppercase tracking-[0.08em]">Ingredientes</h2>
        <table className="w-full text-[14px]">
          <thead><tr className="text-left text-[12px] text-niebla"><th className="py-1.5 font-medium">Producto</th><th className="py-1.5 text-right font-medium">Cantidad</th><th className="py-1.5 text-right font-medium">Bruto</th><th className="py-1.5 text-right font-medium">Coste tanda</th></tr></thead>
          <tbody className="divide-y divide-linea/70">
            {v.ingredientes.map((l, i) => {
              const ref = l.sub_recipe_id ? `rec:${l.sub_recipe_id}` : l.ingredient_id;
              const previas = v.ingredientes.slice(0, i).filter((x) => (x.sub_recipe_id ? `rec:${x.sub_recipe_id}` : x.ingredient_id) === ref).length;
              const nombre = l.sub_recipe_id ? `${cat.subrecetas[l.sub_recipe_id]?.name ?? "Elaboración"} (elaboración)` : cat.ingredientes[l.ingredient_id ?? ""]?.name ?? "—";
              const c = lineasCoste.filter((x) => x.ref === ref)[previas];
              return (
                <tr key={i}>
                  <td className="py-2">{nombre}</td>
                  <td className="py-2 text-right tabular-nums">{Number(l.quantity).toLocaleString("es-ES")} {U[l.unit]}{l.quantity_type === "net" && !l.sub_recipe_id ? " netos" : ""}</td>
                  <td className="py-2 text-right tabular-nums text-grafito">{c?.quantity ? `${Number(c.quantity).toLocaleString("es-ES", { maximumFractionDigits: 1 })} ${c.unit}` : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{c?.amount_batch ? euro(c.amount_batch) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="border-b border-linea py-6">
        <h2 className="mb-3 text-[15px] font-semibold uppercase tracking-[0.08em]">Elaboración</h2>
        <p className="mb-3 text-[13px] text-niebla">
          Preparación {v.prep_minutes ? `${Number(v.prep_minutes)} min` : "—"} · Cocción {v.cook_minutes ? `${Number(v.cook_minutes)} min` : "—"} · Reposo {v.rest_minutes ? `${Number(v.rest_minutes)} min` : "—"}
        </p>
        {v.pasos.length === 0 ? <p className="text-[14px] text-niebla">Sin pasos definidos.</p> : (
          <ol className="space-y-3">
            {v.pasos.map((p, i) => (
              <li key={p.id} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tinta text-[13px] font-semibold text-crema print:border print:border-tinta print:bg-white print:text-tinta">{i + 1}</span>
                <div className="text-[14px]">
                  {p.title && <p className="font-semibold">{p.title}</p>}
                  <p className="whitespace-pre-line">{p.description}</p>
                  <p className="mt-0.5 text-[12px] text-niebla">
                    {[p.minutes ? `${Number(p.minutes)} min` : null, p.temperature_c ? `${Number(p.temperature_c)} °C` : null, p.equipment_id ? cat.equipos[p.equipment_id]?.name : null].filter(Boolean).join(" · ")}
                    {p.is_critical && <strong className="ml-2 text-terracota">▲ Punto crítico</strong>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {v.steps && <p className="mt-4 whitespace-pre-line rounded-xl bg-crema-2 p-3 text-[13px]">{v.steps}</p>}
      </section>

      <section className="grid gap-6 py-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-[15px] font-semibold uppercase tracking-[0.08em]">Conservación</h2>
          <p className="text-[14px]">{v.storage ?? "—"}</p>
          {esPlato && (
            <>
              <h2 className="mb-2 mt-5 text-[15px] font-semibold uppercase tracking-[0.08em]">Presentación</h2>
              <p className="text-[14px]">{v.portion_size ? `Ración: ${v.portion_size}. ` : ""}{v.serving ?? (v.portion_size ? "" : "—")}</p>
            </>
          )}
        </div>
        <div>
          <h2 className="mb-2 text-[15px] font-semibold uppercase tracking-[0.08em]">Alérgenos</h2>
          {alergenos.length ? (
            <ul className="flex flex-wrap gap-2">{alergenos.map((a) => <li key={a} className="rounded-full border border-terracota px-3 py-1 text-[13px] font-medium capitalize text-terracota">{a}</li>)}</ul>
          ) : <p className="text-[14px] text-niebla">Sin alérgenos declarados.</p>}
          <p className="mt-2 text-[11px] text-niebla">Calculados a partir de las fichas de las materias primas. Verificar con proveedores.</p>
        </div>
      </section>
    </article>
  );
}
