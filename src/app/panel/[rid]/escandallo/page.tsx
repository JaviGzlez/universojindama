import { notFound } from "next/navigation";
import { Cabecera, SinPermiso } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarAjustes, cargarImpuestos } from "@/lib/datos";
import { cargarCatalogo } from "@/lib/recetas";
import { EditorReceta } from "../recetas/[id]/editor";

export const metadata = { title: "Escandallo rápido" };

export default async function Escandallo({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "recetas") && !ctx.puedeVer(restaurante, "materias")) return <SinPermiso apartado="los escandallos" />;
  const sb = ctx.supabase;
  const [{ cat }, impuestos, ajustes] = await Promise.all([cargarCatalogo(sb, rid, restaurante.organization_id), cargarImpuestos(sb, rid), cargarAjustes(sb, rid)]);

  return (
    <>
      <Cabecera
        titulo="Escandallo rápido"
        subtitulo="Calcula cualquier plato o elaboración al momento con todo lo que tienes: materias primas, elaboraciones, equipos, personal, consumibles, gastos generales y precio. Si te gusta, guárdalo como receta."
      />
      <EditorReceta
        modo="libre"
        rid={rid}
        recipeId="escandallo"
        kind="dish"
        hayActiva={false}
        puedeEditar={ctx.puede(restaurante, "recetas")}
        puedeCrearMaterias={ctx.puede(restaurante, "materias")}
        catalogo={cat}
        impuestosVenta={impuestos.filter((x) => x.kind === "sale").map((x) => ({ id: x.id, name: x.name, rate: x.rate }))}
        decimales={ajustes?.money_decimals ?? 2}
        version={{
          id: "libre", number: 0, status: "draft", version: 0, portions: "1", yield_quantity: null, yield_unit: "g",
          labor_is_variable: false, use_overheads: true, steps: null, notes: null,
          ingredientes: [], equipos: [], personal: [], consumibles: [],
          prep_minutes: null, cook_minutes: null, rest_minutes: null, shelf_life_hours: null, storage: null, serving: null, portion_size: null,
          extra_allergens: [], pasos: [],
        }}
      />
    </>
  );
}
