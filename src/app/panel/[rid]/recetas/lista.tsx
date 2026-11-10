import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, SinPermiso, Tarjeta, Vacio, euro } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarCatalogo, cargarVersion, editable } from "@/lib/recetas";
import { alergenosDe } from "@/lib/recetas-entrada";
import { crearReceta } from "./actions";

const ESTADO = { complete: ["Completo", "ok"], estimated: ["Estimado", "estimado"], incomplete: ["Incompleto", "pendiente"] } as const;

/** Listado de platos o de elaboraciones con coste, alérgenos, tiempos y usos. */
export async function ListaRecetas({ rid, kind, buscar }: { rid: string; kind: "dish" | "preparation"; buscar?: string }) {
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "recetas")) return <SinPermiso apartado="las recetas" />;
  const sb = ctx.supabase;
  const esPlato = kind === "dish";
  const [{ cat, recetas }, { data: costes }, { data: borradores }, { data: usos }] = await Promise.all([
    cargarCatalogo(sb, rid, restaurante.organization_id),
    sb.from("latest_cost_snapshots").select("recipe_id, status, direct_per_unit").eq("restaurant_id", rid),
    sb.from("recipe_versions").select("recipe_id").eq("restaurant_id", rid).eq("status", "draft"),
    esPlato ? Promise.resolve({ data: [] }) :
      sb.from("recipe_ingredients").select("sub_recipe_id, recipe_versions!inner(recipe_id, status)").eq("restaurant_id", rid).not("sub_recipe_id", "is", null).eq("recipe_versions.status", "active"),
  ]);
  const coste = new Map((costes ?? []).map((c) => [c.recipe_id as string, c]));
  const conBorrador = new Set((borradores ?? []).map((b) => b.recipe_id as string));
  const usadaEn = new Map<string, Set<string>>();
  for (const u of (usos ?? []) as unknown as { sub_recipe_id: string; recipe_versions: { recipe_id: string } }[]) {
    if (!usadaEn.has(u.sub_recipe_id)) usadaEn.set(u.sub_recipe_id, new Set());
    usadaEn.get(u.sub_recipe_id)!.add(u.recipe_versions.recipe_id);
  }
  const q = (buscar ?? "").trim().toLowerCase();
  const lista = recetas.filter((x) => x.kind === kind && (!q || x.name.toLowerCase().includes(q) || (x.category ?? "").toLowerCase().includes(q)));
  // ficha de la versión activa (tiempos, vida útil, alérgenos)
  const fichas = new Map<string, { min: number; vida: string | null; alergenos: string[]; raciones: string | null; produce: string | null }>();
  await Promise.all(lista.filter((x) => x.active_version_id).map(async (x) => {
    const v = await cargarVersion(sb, x.active_version_id!);
    if (!v) return;
    fichas.set(x.id, {
      min: (Number(v.prep_minutes) || 0) + (Number(v.cook_minutes) || 0) + (Number(v.rest_minutes) || 0),
      vida: v.shelf_life_hours, alergenos: alergenosDe(editable(v, kind), cat, v.extra_allergens),
      raciones: v.portions, produce: v.yield_quantity ? `${Number(v.yield_quantity).toLocaleString("es-ES")} ${v.yield_unit === "unit" ? "ud" : v.yield_unit}` : null,
    });
  }));
  const categorias = [...new Set(lista.map((x) => x.category ?? (esPlato ? "Sin categoría" : "Sin tipo")))].sort();
  const puede = ctx.puede(restaurante, "recetas");
  const base = `/panel/${rid}/${esPlato ? "recetas" : "elaboraciones"}`;

  return (
    <>
      <Cabecera
        titulo={esPlato ? "Platos" : "Elaboraciones"}
        subtitulo={esPlato
          ? "Recetas de venta: qué lleva cada plato, cómo se hace, cuánto cuesta por ración y sus alérgenos. Pueden usar elaboraciones (salsas, fondos, masas) sin volver a contar sus ingredientes."
          : "Salsas, fondos, masas, aliños, bases… Lo que preparas para usar en varios platos: qué lleva, cuánto produce, el proceso con tiempos y temperaturas, cuánto dura y cuánto cuesta por kilo o litro."}
      >
        <form className="flex gap-2" action={base}>
          <input name="q" defaultValue={buscar} placeholder="Buscar…" className="h-10 w-56 rounded-full border border-linea bg-white px-4 text-[14px] outline-none focus:border-musgo" />
        </form>
      </Cabecera>

      {puede && (
        <Tarjeta className="mb-8">
          <FormularioAccion action={crearReceta} boton={esPlato ? "Crear plato" : "Crear elaboración"}>
            <input type="hidden" name="rid" value={rid} />
            <input type="hidden" name="kind" value={kind} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo label="Nombre" name="name" required placeholder={esPlato ? "Croquetas de jamón" : "Salsa brava"} className="sm:col-span-2" />
              <Campo label={esPlato ? "Categoría" : "Tipo"} name="category" placeholder={esPlato ? "Entrantes" : "Salsas"} list={`cats-${kind}`} />
              <datalist id={`cats-${kind}`}>
                {(esPlato ? ["Entrantes", "Principales", "Postres", "Hamburguesas", "Bebidas"] : ["Salsas", "Fondos y caldos", "Masas", "Aliños y vinagretas", "Guarniciones", "Bases", "Postres base"]).map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </FormularioAccion>
        </Tarjeta>
      )}

      {lista.length === 0 && (
        <Vacio titulo={q ? "Sin resultados" : esPlato ? "Aún no hay platos" : "Aún no hay elaboraciones"}
          texto={esPlato ? "Crea tus platos y añade sus ingredientes y elaboraciones." : "Empieza por las salsas y bases que usas en varios platos."} />
      )}

      {categorias.map((c) => {
        const items = lista.filter((x) => (x.category ?? (esPlato ? "Sin categoría" : "Sin tipo")) === c);
        if (!items.length) return null;
        return (
          <section key={c} className="mb-10">
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.1em] text-niebla">{c}</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {items.map((x) => {
                const k = coste.get(x.id);
                const f = fichas.get(x.id);
                const valor = k?.direct_per_unit ? Number(k.direct_per_unit) * (esPlato ? 1 : 1000) : null;
                const est = k ? ESTADO[k.status as keyof typeof ESTADO] : null;
                const usos = usadaEn.get(x.id)?.size ?? 0;
                return (
                  <li key={x.id}>
                    <Link href={`/panel/${rid}/recetas/${x.id}`} className="group block rounded-[20px] bg-white p-5 ring-1 ring-linea transition hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-28px_rgba(40,30,20,0.45)]">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-[16px] font-semibold">{x.name}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-niebla">
                            {!x.active_version_id && <Insignia tono="pendiente">Sin activar</Insignia>}
                            {conBorrador.has(x.id) && x.active_version_id && <Insignia>Borrador abierto</Insignia>}
                            {est && <Insignia tono={est[1]}>{est[0]}</Insignia>}
                            {f?.min ? <span>· {f.min >= 60 ? `${Math.floor(f.min / 60)} h ${f.min % 60 ? `${f.min % 60} min` : ""}` : `${f.min} min`}</span> : null}
                            {esPlato && f?.raciones ? <span>· {Number(f.raciones)} rac.</span> : null}
                            {!esPlato && f?.produce ? <span>· produce {f.produce}</span> : null}
                            {f?.vida ? <span>· dura {Number(f.vida) >= 48 ? `${Math.round(Number(f.vida) / 24)} días` : `${Number(f.vida)} h`}</span> : null}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[18px] font-semibold tabular-nums">{valor === null ? "—" : euro(valor, 2)}</p>
                          <p className="text-[12px] text-niebla">{esPlato ? "por ración" : "por kg / l / ud"}</p>
                        </div>
                      </div>
                      {(f?.alergenos.length || (!esPlato && usos)) ? (
                        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                          {f?.alergenos.length ? <span className="capitalize text-terracota">{f.alergenos.join(" · ")}</span> : null}
                          {!esPlato && usos ? <span className="text-musgo">Usada en {usos} {usos === 1 ? "receta" : "recetas"}</span> : null}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
