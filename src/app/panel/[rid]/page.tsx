import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida } from "@/components/formulario-accion";
import { COLOR_SERIE } from "@/components/graficos";
import { Mundo, mundoDeSlug } from "@/components/mundo";
import { Tarjeta } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarEquipos, cargarImpuestos, cargarIngredientes, cargarPerfiles, cargarTarifas } from "@/lib/datos";
import { resumenPorRestaurante } from "@/lib/economia";
import { resolverAviso } from "./actions";
import { ResumenRestaurante } from "./resumen";

export default async function Inicio({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const anio = new Date().getUTCFullYear();
  const hasta = new Date(Date.UTC(anio, new Date().getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  const [ings, equipos, perfiles, tarifas, impuestos, resumen, { data: avisos }, { count: nRecetas }, { count: nCarta }] = await Promise.all([
    cargarIngredientes(sb, rid, restaurante.organization_id),
    cargarEquipos(sb, rid),
    cargarPerfiles(sb, rid),
    cargarTarifas(sb, rid),
    cargarImpuestos(sb, rid),
    resumenPorRestaurante(sb, [rid], `${anio}-01-01`, hasta),
    sb.from("alerts").select("id, title, body, severity, created_at").eq("restaurant_id", rid).is("resolved_at", null).order("created_at", { ascending: false }).limit(6),
    sb.from("recipes").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("status", "active"),
    sb.from("menu_items").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("status", "active"),
  ]);
  const conPrecio = ings.filter((i) => i.precio).length;
  const base = `/panel/${rid}`;
  const mundo = mundoDeSlug(restaurante.slug);

  const pasos = [
    { titulo: "Tarifa de electricidad", hecho: tarifas.some((t) => t.source === "electricity"), detalle: `${tarifas.length} tarifas`, href: `${base}/ajustes` },
    { titulo: "Impuesto de venta", hecho: impuestos.some((t) => t.kind === "sale"), detalle: `${impuestos.length} impuestos`, href: `${base}/ajustes` },
    { titulo: "Perfiles de personal", hecho: perfiles.length > 0, detalle: `${perfiles.length} perfiles`, href: `${base}/personal` },
    { titulo: "Equipos con tarifa", hecho: equipos.some((e) => e.energy_tariff_id), detalle: `${equipos.length} equipos`, href: `${base}/equipos` },
    { titulo: "Materias primas con precio", hecho: conPrecio > 0, detalle: `${conPrecio} de ${ings.length}`, href: `${base}/ingredientes` },
    { titulo: "Recetas activas", hecho: (nRecetas ?? 0) > 0, detalle: `${nRecetas ?? 0} recetas`, href: `${base}/recetas` },
    { titulo: "Carta con precios", hecho: (nCarta ?? 0) > 0, detalle: `${nCarta ?? 0} platos`, href: `${base}/carta` },
  ];
  const completados = pasos.filter((p) => p.hecho).length;
  const puedeResolver = ["kitchen", "purchasing", "accounting", "admin", "owner"].some((x) => ctx.roles(restaurante).includes(x as never));

  return (
    <>
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
        <Mundo id={mundo} size={84} />
        <div>
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-niebla">Hola, {ctx.nombre.split(" ")[0]}</p>
          <h1 className="mt-1 text-[40px] font-semibold leading-tight tracking-[-0.03em] md:text-[48px]">{restaurante.name}</h1>
        </div>
      </div>

      {(avisos?.length ?? 0) > 0 && (
        <section className="mt-8 space-y-2" aria-label="Avisos">
          {avisos!.map((a) => (
            <div key={a.id} className={`flex flex-col gap-2 rounded-2xl px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${a.severity === "critical" ? "bg-terracota-claro" : "bg-ambar-claro"}`}>
              <div>
                <p className={`text-[14px] font-semibold ${a.severity === "critical" ? "text-terracota" : "text-ambar"}`}>
                  <span aria-hidden="true">▲ </span>{a.title}
                </p>
                {a.body && <p className="text-[13px] text-grafito">{a.body}</p>}
              </div>
              {puedeResolver && <AccionRapida action={resolverAviso} etiqueta="Entendido" campos={{ restaurant_id: rid, id: a.id }} />}
            </div>
          ))}
        </section>
      )}

      {ctx.puedeVer(restaurante, "economia") && (
        <div className="mt-8">
          <ResumenRestaurante meses={resumen.get(rid) ?? []} color={COLOR_SERIE[mundo]} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Tarjeta>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Configuración</h2>
            <span className="text-[13px] text-niebla">{completados} de {pasos.length}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-crema-2" role="progressbar" aria-valuemin={0} aria-valuemax={pasos.length} aria-valuenow={completados}>
            <div className="h-full rounded-full bg-musgo transition-all" style={{ width: `${(completados / pasos.length) * 100}%` }} />
          </div>
          <ul className="mt-5 divide-y divide-linea/70">
            {pasos.map((p) => (
              <li key={p.titulo}>
                <Link href={p.href} className="flex items-center justify-between gap-4 py-3 hover:opacity-80">
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] ${p.hecho ? "bg-musgo text-white" : "border border-linea text-niebla"}`}>
                      {p.hecho ? "✓" : ""}
                    </span>
                    <span className="text-[15px] font-medium">{p.titulo}</span>
                  </span>
                  <span className="text-[13px] text-niebla">{p.detalle}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Tarjeta>

        <div className="grid gap-4">
          {([
            { t: "Platos y elaboraciones", d: "Fichas técnicas con versiones, procesos e histórico de costes.", h: `${base}/recetas`, a: "recetas" },
            { t: "Escandallo rápido", d: "Calcula cualquier plato al momento y guárdalo como receta.", h: `${base}/escandallo`, a: "materias" },
            { t: "Facturas", d: "Registra compras: actualizan precios, inventario y escandallos.", h: `${base}/compras`, a: "compras" },
            { t: "Resultados", d: "Ingresos, compras, personal y gastos por mes.", h: `${base}/economia`, a: "economia" },
          ] as const).filter((x) => ctx.puedeVer(restaurante, x.a)).map((x) => (
            <Link key={x.t} href={x.h} className="group rounded-[22px] bg-white p-5 ring-1 ring-linea transition hover:-translate-y-0.5">
              <p className="flex items-center justify-between text-[16px] font-semibold">
                {x.t} <span className="text-niebla transition group-hover:translate-x-1 group-hover:text-tinta" aria-hidden="true">→</span>
              </p>
              <p className="mt-1 text-[13px] text-niebla">{x.d}</p>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
