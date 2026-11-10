import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida } from "@/components/formulario-accion";
import { COLOR_SERIE } from "@/components/graficos";
import { mundoDeSlug } from "@/components/mundo";
import { Cabecera, Insignia, euro, SinPermiso } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { resumenPorRestaurante } from "@/lib/economia";
import { ResumenRestaurante } from "../resumen";
import { cambiarPeriodo } from "./actions";

export const metadata = { title: "Resultados" };

export default async function Resultados({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ anio?: string; ver?: string }> }) {
  const { rid } = await params;
  const sp = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "economia")) return <SinPermiso apartado="economía" />;
  const sb = ctx.supabase;
  const anio = Number(sp.anio) >= 2000 ? Number(sp.anio) : new Date().getUTCFullYear();
  const grupo = sp.ver === "grupo";
  const ids = grupo ? ctx.restaurants.map((x) => x.id) : [rid];
  const [resumen, { data: periodos }, { data: categorias }] = await Promise.all([
    resumenPorRestaurante(sb, ids, `${anio}-01-01`, `${anio}-12-31`),
    sb.from("financial_periods").select("year, month, status").eq("restaurant_id", rid).eq("year", anio),
    sb.rpc("category_summary", { p_restaurants: ids, p_from: `${anio}-01-01`, p_to: `${anio}-12-31` }),
  ]);
  // suma de restaurantes
  const meses = (resumen.get(ids[0]) ?? []).map((m, i) => {
    const filas = ids.map((id) => resumen.get(id)![i]);
    const s = (k: "ingresos" | "compras" | "personal" | "gastos" | "financiacion" | "inversion" | "resultado") => filas.reduce((a, f) => a + f[k], 0);
    return { mes: m.mes, ingresos: s("ingresos"), compras: s("compras"), personal: s("personal"), gastos: s("gastos"), financiacion: s("financiacion"), inversion: s("inversion"), resultado: s("resultado"), conDatos: filas.some((f) => f.conDatos) };
  });
  const cerrado = new Map((periodos ?? []).map((p) => [`${p.year}-${String(p.month).padStart(2, "0")}`, p.status === "closed"]));
  const total = (k: keyof (typeof meses)[number]) => meses.reduce((a, m) => a + (m[k] as number), 0);
  const ingresos = total("ingresos");
  const pct = (v: number) => (ingresos ? `${((v / ingresos) * 100).toFixed(1).replace(".", ",")} %` : "");
  const puede = ctx.puede(restaurante, "economia");
  const mesNombre = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { month: "long", timeZone: "UTC" });
  const cats = ((categorias ?? []) as { kind: string; nature: string; category: string; total: string }[]);
  const gastoCats = cats.filter((c) => c.kind === "expense").sort((a, b) => Number(b.total) - Number(a.total));
  const proveedoresTop = cats.filter((c) => c.kind === "purchase");
  const link = (q: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ anio: String(anio), ver: grupo ? "grupo" : undefined, ...q }).filter(([, v]) => v) as [string, string][]).toString()}`;

  return (
    <>
      <Cabecera
        titulo="Resultados"
        subtitulo="Ingresos menos compras, personal y gastos operativos, por mes. Préstamos e inversiones se muestran aparte. Son importes registrados, no un cierre contable."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Link href={link({ anio: String(anio - 1) })} className="rounded-full px-3 py-1.5 text-[14px] hover:bg-tinta/5">← {anio - 1}</Link>
          <span className="text-[15px] font-semibold">{anio}</span>
          <Link href={link({ anio: String(anio + 1) })} className="rounded-full px-3 py-1.5 text-[14px] hover:bg-tinta/5">{anio + 1} →</Link>
          <span className="mx-2 h-5 w-px bg-linea" />
          <Link href={link({ ver: undefined })} className={`h-8 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${!grupo ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>{restaurante.name}</Link>
          <Link href={link({ ver: "grupo" })} className={`h-8 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${grupo ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>Grupo</Link>
        </div>
      </Cabecera>

      <ResumenRestaurante meses={meses} color={grupo ? COLOR_SERIE.grupo : COLOR_SERIE[mundoDeSlug(restaurante.slug)]} />

      <div className="mt-6 overflow-x-auto rounded-[22px] bg-white ring-1 ring-linea">
        <table className="w-full min-w-[860px] text-right text-[14px] tabular-nums">
          <thead>
            <tr className="border-b border-linea text-[12px] uppercase tracking-[0.06em] text-niebla">
              <th className="px-4 py-3 text-left font-medium">Mes</th>
              <th className="px-4 py-3 font-medium">Ingresos</th>
              <th className="px-4 py-3 font-medium">Compras</th>
              <th className="px-4 py-3 font-medium">Personal</th>
              <th className="px-4 py-3 font-medium">Gastos</th>
              <th className="px-4 py-3 font-medium">Resultado</th>
              <th className="px-4 py-3 font-medium">Préstamos</th>
              <th className="px-4 py-3 font-medium">Inversión</th>
              {!grupo && <th className="px-4 py-3 font-medium">Periodo</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-linea/70">
            {meses.map((m) => {
              const clave = m.mes.slice(0, 7);
              const cer = cerrado.get(clave) ?? false;
              return (
                <tr key={m.mes} className={m.conDatos ? "" : "text-niebla"}>
                  <td className="px-4 py-2.5 text-left font-medium first-letter:uppercase">{mesNombre(m.mes)}</td>
                  <td className="px-4 py-2.5">{m.conDatos ? euro(m.ingresos, 0) : "—"}</td>
                  <td className="px-4 py-2.5">{m.conDatos ? euro(m.compras, 0) : "—"}</td>
                  <td className="px-4 py-2.5">{m.conDatos ? euro(m.personal, 0) : "—"}</td>
                  <td className="px-4 py-2.5">{m.conDatos ? euro(m.gastos, 0) : "—"}</td>
                  <td className={`px-4 py-2.5 font-semibold ${m.resultado < 0 ? "text-terracota" : ""}`}>{m.conDatos ? euro(m.resultado, 0) : "—"}</td>
                  <td className="px-4 py-2.5 text-grafito">{m.financiacion ? euro(m.financiacion, 0) : "—"}</td>
                  <td className="px-4 py-2.5 text-grafito">{m.inversion ? euro(m.inversion, 0) : "—"}</td>
                  {!grupo && (
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        {cer ? <Insignia tono="ok">Cerrado</Insignia> : m.conDatos ? <Insignia>Abierto</Insignia> : null}
                        {puede && m.conDatos && (
                          <AccionRapida action={cambiarPeriodo} etiqueta={cer ? "Reabrir" : "Cerrar"}
                            confirmar={cer ? undefined : "Al cerrar el periodo no se podrán cambiar sus movimientos hasta reabrirlo."}
                            campos={{ rid, mes: clave, estado: cer ? "open" : "closed" }} />
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-linea font-semibold">
              <td className="px-4 py-3 text-left">Total {anio}</td>
              <td className="px-4 py-3">{euro(ingresos, 0)}</td>
              <td className="px-4 py-3">{euro(total("compras"), 0)}<p className="text-[11px] font-normal text-niebla">{pct(total("compras"))}</p></td>
              <td className="px-4 py-3">{euro(total("personal"), 0)}<p className="text-[11px] font-normal text-niebla">{pct(total("personal"))}</p></td>
              <td className="px-4 py-3">{euro(total("gastos"), 0)}<p className="text-[11px] font-normal text-niebla">{pct(total("gastos"))}</p></td>
              <td className={`px-4 py-3 ${total("resultado") < 0 ? "text-terracota" : ""}`}>{euro(total("resultado"), 0)}<p className="text-[11px] font-normal text-niebla">{pct(total("resultado"))}</p></td>
              <td className="px-4 py-3">{euro(total("financiacion"), 0)}</td>
              <td className="px-4 py-3">{euro(total("inversion"), 0)}</td>
              {!grupo && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {(gastoCats.length > 0 || proveedoresTop.length > 0) && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Desglose titulo="Gastos por concepto" filas={gastoCats.map((c) => ({ nombre: `${c.category}${c.nature !== "operating" ? (c.nature === "financing" ? " (financiación)" : " (inversión)") : ""}`, valor: Number(c.total) }))} />
          <ProveedoresTop rids={ids} anio={anio} />
        </div>
      )}
    </>
  );
}

function Desglose({ titulo, filas }: { titulo: string; filas: { nombre: string; valor: number }[] }) {
  const max = Math.max(1, ...filas.map((f) => Math.abs(f.valor)));
  return (
    <section className="rounded-[22px] bg-white p-6 ring-1 ring-linea">
      <h2 className="mb-4 text-[17px] font-semibold">{titulo}</h2>
      <ul className="space-y-3">
        {filas.slice(0, 12).map((f) => (
          <li key={f.nombre}>
            <div className="mb-1 flex justify-between text-[14px]"><span>{f.nombre}</span><span className="tabular-nums text-grafito">{euro(f.valor, 0)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-crema-2"><div className="h-full rounded-full bg-grafito" style={{ width: `${(Math.abs(f.valor) / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function ProveedoresTop({ rids, anio }: { rids: string[]; anio: number }) {
  const { createClient } = await import("@/lib/supabase/server");
  const sb = await createClient();
  const { data } = await sb.rpc("counterparty_summary", { p_restaurants: rids, p_from: `${anio}-01-01`, p_to: `${anio}-12-31`, p_kind: "purchase" });
  const filas = ((data ?? []) as { counterparty: string; total: string }[]).map((d) => ({ nombre: d.counterparty, valor: Number(d.total) }));
  if (filas.length === 0) return null;
  return <Desglose titulo="Compras por proveedor" filas={filas} />;
}
