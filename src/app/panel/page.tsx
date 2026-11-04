import Link from "next/link";
import { redirect } from "next/navigation";
import { salir } from "@/app/acceso/actions";
import { ListaActividad } from "@/components/lista-actividad";
import { Marca } from "@/components/marca";
import { mundoDeSlug } from "@/components/mundo";
import { cargarActividad } from "@/lib/actividad";
import { getContexto } from "@/lib/contexto";
import { resumenPorRestaurante } from "@/lib/economia";
import { Universo, type RestauranteUniverso } from "./universo";

export const metadata = { title: "Universo" };

function saludo(tz: string) {
  const h = Number(new Intl.DateTimeFormat("es-ES", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()));
  return h < 6 ? "Buenas noches" : h < 14 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
}

export default async function PanelGrupo() {
  const ctx = await getContexto();
  if (!ctx || ctx.restaurants.length === 0) redirect("/acceso");
  const sb = ctx.supabase;
  const ids = ctx.restaurants.map((r) => r.id);
  const tz = ctx.restaurants[0].timezone;

  const hoy = new Date();
  const anio = hoy.getUTCFullYear();
  const desde = `${anio}-01-01`;
  const hasta = new Date(Date.UTC(anio, hoy.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  const [resumen, actividad, { data: recetas }, { data: avisos }] = await Promise.all([
    resumenPorRestaurante(sb, ids, desde, hasta),
    cargarActividad(sb, { restaurantes: ctx.restaurants, limite: 12 }),
    sb.from("recipes").select("restaurant_id").eq("status", "active"),
    sb.from("alerts").select("restaurant_id").is("resolved_at", null),
  ]);

  const cuenta = (rows: { restaurant_id: string }[] | null, rid: string) => (rows ?? []).filter((x) => x.restaurant_id === rid).length;
  const datos: RestauranteUniverso[] = ctx.restaurants.map((r) => ({
    id: r.id,
    nombre: r.name,
    mundo: mundoDeSlug(r.slug),
    meses: resumen.get(r.id) ?? [],
    recetas: cuenta(recetas, r.id),
    avisos: cuenta(avisos, r.id),
  }));
  const primero = ctx.restaurants[0].id;

  return (
    <div className="min-h-screen bg-crema">
      <header className="sticky top-0 z-40 border-b border-linea/60 bg-crema/75 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 md:px-8" aria-label="Universo">
          <Marca href="/panel" />
          <div className="flex items-center gap-1 text-[13px]">
            <Link href={`/panel/${primero}/economia/importar`} className="hidden rounded-full px-3 py-1.5 text-grafito hover:bg-tinta/5 sm:inline-flex">Importar Excel</Link>
            <Link href={`/panel/${primero}/usuarios`} className="hidden rounded-full px-3 py-1.5 text-grafito hover:bg-tinta/5 sm:inline-flex">Usuarios</Link>
            <form action={salir}>
              <button className="rounded-full px-3 py-1.5 text-grafito hover:bg-tinta/5">Salir</button>
            </form>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-12 md:px-8 md:pt-16">
        <div className="text-center">
          <p className="aparecer text-[13px] font-medium uppercase tracking-[0.18em] text-niebla">{saludo(tz)}, {ctx.nombre.split(" ")[0]}</p>
          <h1 className="aparecer mt-3 text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[64px]" style={{ animationDelay: "80ms" }}>
            Tu universo, <span className="font-serif font-normal italic">de un vistazo.</span>
          </h1>
          <p className="aparecer mx-auto mt-4 max-w-xl text-[16px] text-grafito md:text-[18px]" style={{ animationDelay: "160ms" }}>
            Toca un mundo para ver sus cifras o el centro para el grupo. Entra en cada casa desde abajo.
          </p>
        </div>

        <Universo restaurantes={datos} anio={anio} />

        <section className="mt-20" aria-labelledby="act-t">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="act-t" className="text-[24px] font-semibold tracking-[-0.02em]">Actividad reciente</h2>
            <Link href={`/panel/${primero}/actividad?ver=grupo`} className="text-[14px] font-medium text-musgo hover:underline">Ver toda</Link>
          </div>
          {actividad.items.length === 0 ? (
            <p className="rounded-[22px] border border-dashed border-linea px-6 py-8 text-center text-[14px] text-niebla">Todavía no hay actividad.</p>
          ) : (
            <ListaActividad items={actividad.items} tz={tz} />
          )}
        </section>
      </main>
    </div>
  );
}
