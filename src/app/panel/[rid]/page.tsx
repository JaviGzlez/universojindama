import Link from "next/link";
import { notFound } from "next/navigation";
import { Mundo, mundoDeSlug } from "@/components/mundo";
import { Insignia, Tarjeta } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarEquipos, cargarImpuestos, cargarIngredientes, cargarPerfiles, cargarTarifas } from "@/lib/datos";
import { cargarActividad } from "@/lib/actividad";
import { ListaActividad } from "@/components/lista-actividad";

export default async function Inicio({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const [ings, equipos, perfiles, tarifas, impuestos, actividad] = await Promise.all([
    cargarIngredientes(ctx.supabase, rid, restaurante.organization_id),
    cargarEquipos(ctx.supabase, rid),
    cargarPerfiles(ctx.supabase, rid),
    cargarTarifas(ctx.supabase, rid),
    cargarImpuestos(ctx.supabase, rid),
    cargarActividad(ctx.supabase, { restaurantes: ctx.restaurants, restauranteId: rid, limite: 6 }),
  ]);
  const conPrecio = ings.filter((i) => i.precio).length;
  const base = `/panel/${rid}`;

  const pasos = [
    { titulo: "Tarifa de electricidad", hecho: tarifas.some((t) => t.source === "electricity"), detalle: `${tarifas.length} tarifas`, href: `${base}/ajustes` },
    { titulo: "Impuesto de venta", hecho: impuestos.some((t) => t.kind === "sale"), detalle: `${impuestos.length} impuestos`, href: `${base}/ajustes` },
    { titulo: "Perfiles de personal", hecho: perfiles.length > 0, detalle: `${perfiles.length} perfiles`, href: `${base}/personal` },
    { titulo: "Equipos con tarifa", hecho: equipos.some((e) => e.energy_tariff_id), detalle: `${equipos.length} equipos`, href: `${base}/equipos` },
    { titulo: "Materias primas con precio", hecho: conPrecio > 0, detalle: `${conPrecio} de ${ings.length} con precio`, href: `${base}/ingredientes` },
  ];
  const completados = pasos.filter((p) => p.hecho).length;

  return (
    <>
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
        <Mundo id={mundoDeSlug(restaurante.slug)} size={84} />
        <div>
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-niebla">Hola, {ctx.nombre.split(" ")[0]}</p>
          <h1 className="mt-1 text-[40px] font-semibold leading-tight tracking-[-0.03em] md:text-[48px]">{restaurante.name}</h1>
        </div>
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Tarjeta>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Configuración inicial</h2>
            <span className="text-[13px] text-niebla">{completados} de {pasos.length}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-crema-2" role="progressbar" aria-valuemin={0} aria-valuemax={pasos.length} aria-valuenow={completados}>
            <div className="h-full rounded-full bg-musgo transition-all" style={{ width: `${(completados / pasos.length) * 100}%` }} />
          </div>
          <ul className="mt-6 divide-y divide-linea/70">
            {pasos.map((p) => (
              <li key={p.titulo}>
                <Link href={p.href} className="flex items-center justify-between gap-4 py-3.5 hover:opacity-80">
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

        <Tarjeta className="flex flex-col bg-tinta text-crema ring-0">
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-crema/60">Escandallo</p>
          <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em]">Calcula un plato con tus datos reales.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-crema/70">
            Materia prima, energía, personal y consumibles, con su desglose. Lo que falte aparece como pendiente, nunca como cero.
          </p>
          <Link href={`${base}/escandallo`} className="mt-auto inline-flex h-11 w-fit items-center rounded-full bg-crema px-5 pt-0 text-[14px] font-medium text-tinta hover:bg-white">
            Abrir escandallo
          </Link>
        </Tarjeta>
      </div>

      <section className="mt-10" aria-labelledby="act-t">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="act-t" className="text-[24px] font-semibold tracking-[-0.02em]">Actividad reciente</h2>
          <Link href={`${base}/actividad`} className="text-[14px] font-medium text-musgo hover:underline">Ver toda</Link>
        </div>
        {actividad.items.length === 0 ? (
          <p className="rounded-[22px] border border-dashed border-linea px-6 py-8 text-center text-[14px] text-niebla">Todavía no hay actividad en {restaurante.name}.</p>
        ) : (
          <ListaActividad items={actividad.items} tz={restaurante.timezone} agruparPorDia={false} mostrarRestaurante={false} />
        )}
      </section>

      <p className="mt-10 flex flex-wrap items-center gap-2 text-[13px] text-niebla">
        <Insignia>Fase 1</Insignia> Recetas guardadas, compras, inventario, ventas y control económico llegan en las siguientes fases.
      </p>
    </>
  );
}
