import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Selector, Tarjeta, Vacio, euro } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarRecetas } from "@/lib/recetas";
import { crearReceta } from "./actions";

export const metadata = { title: "Recetas" };

const ESTADO = { complete: ["Completo", "ok"], estimated: ["Estimado", "estimado"], incomplete: ["Incompleto", "pendiente"] } as const;

export default async function Recetas({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const [recetas, { data: costes }, { data: borradores }] = await Promise.all([
    cargarRecetas(ctx.supabase, rid),
    ctx.supabase.from("latest_cost_snapshots").select("recipe_id, status, direct_per_unit, full_per_unit, created_at").eq("restaurant_id", rid),
    ctx.supabase.from("recipe_versions").select("recipe_id, yield_unit").eq("restaurant_id", rid).eq("status", "draft"),
  ]);
  const coste = new Map((costes ?? []).map((c) => [c.recipe_id as string, c]));
  const conBorrador = new Set((borradores ?? []).map((b) => b.recipe_id as string));
  const puede = ctx.puede(restaurante, "equipos");

  const grupos = [
    { titulo: "Platos de venta", items: recetas.filter((x) => x.kind === "dish"), unidad: "ración" },
    { titulo: "Elaboraciones intermedias", items: recetas.filter((x) => x.kind === "preparation"), unidad: "kg / l / ud" },
  ];

  return (
    <>
      <Cabecera
        titulo="Recetas y elaboraciones"
        subtitulo="Cada receta tiene versiones: se edita un borrador y, al activarlo, la anterior queda en el histórico con su coste. Los cambios de precio recalculan las recetas activas automáticamente."
      />

      {puede && (
        <Tarjeta className="mb-8">
          <FormularioAccion action={crearReceta} boton="Crear y editar">
            <input type="hidden" name="rid" value={rid} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Nombre" name="name" required placeholder="Croquetas de jamón" className="sm:col-span-2" />
              <Selector label="Tipo" name="kind" defaultValue="dish">
                <option value="dish">Plato de venta</option>
                <option value="preparation">Elaboración intermedia</option>
              </Selector>
              <Campo label="Categoría" name="category" placeholder="Entrantes" />
            </div>
          </FormularioAccion>
        </Tarjeta>
      )}

      {recetas.length === 0 && <Vacio titulo="Aún no hay recetas" texto="Empieza por las elaboraciones (salsas, fondos, masas) y después los platos que las usan." />}

      {grupos.filter((g) => g.items.length).map((g) => (
        <section key={g.titulo} className="mb-10">
          <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-niebla">{g.titulo}</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {g.items.map((x) => {
              const c = coste.get(x.id);
              const esPlato = x.kind === "dish";
              // elaboración: el coste guardado es por g/ml/ud; se muestra por kg/l/ud
              const valor = c?.direct_per_unit ? Number(c.direct_per_unit) * (esPlato ? 1 : 1000) : null;
              const est = c ? ESTADO[c.status as keyof typeof ESTADO] : null;
              return (
                <li key={x.id}>
                  <Link href={`/panel/${rid}/recetas/${x.id}`} className="group flex items-center justify-between gap-4 rounded-[20px] bg-white p-5 ring-1 ring-linea transition hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-28px_rgba(40,30,20,0.45)]">
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-semibold">{x.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-niebla">
                        {x.category ?? (esPlato ? "Plato" : "Elaboración")}
                        {!x.active_version_id && <Insignia tono="pendiente">Sin activar</Insignia>}
                        {conBorrador.has(x.id) && x.active_version_id && <Insignia>Borrador abierto</Insignia>}
                        {est && <Insignia tono={est[1]}>{est[0]}</Insignia>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[18px] font-semibold tabular-nums">{valor === null ? "—" : euro(valor, 2)}</p>
                      <p className="text-[12px] text-niebla">{esPlato ? "por ración" : "por kg / l / ud"}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
