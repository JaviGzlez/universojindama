import Link from "next/link";
import { redirect } from "next/navigation";
import { salir } from "@/app/acceso/actions";
import { Marca } from "@/components/marca";
import { mundoDeSlug } from "@/components/mundo";
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

  const [resumen, { data: recetas }, { data: avisos }] = await Promise.all([
    resumenPorRestaurante(sb, ids, desde, hasta),
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
  const propietario = ctx.esPropietario(ctx.restaurants[0].organization_id);

  return (
    <div className="min-h-screen bg-crema">
      <header className="sticky top-0 z-40 border-b border-linea/60 bg-crema/75 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 md:px-8" aria-label="Universo">
          <Marca href="/panel" />
          <div className="flex items-center gap-1 text-[13px]">
            {propietario && (
              <Link href="/panel/administracion" className="rounded-full px-3 py-1.5 font-medium text-tinta hover:bg-tinta/5">Administración</Link>
            )}
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
            Toca un mundo para ver sus cifras. Doble clic para entrar en ese restaurante.
          </p>
        </div>

        <Universo restaurantes={datos} anio={anio} />
      </main>
    </div>
  );
}
