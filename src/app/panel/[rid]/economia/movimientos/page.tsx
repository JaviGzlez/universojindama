import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Selector, Tabla, Tarjeta, Vacio, euro, SinPermiso } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { NOMBRE_TIPO, type TipoMovimiento } from "@/lib/economia";
import { borrarMovimiento, crearMovimiento } from "../actions";

export const metadata = { title: "Movimientos" };

export default async function Movimientos({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ mes?: string; tipo?: string }> }) {
  const { rid } = await params;
  const sp = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "economia")) return <SinPermiso apartado="economía" />;
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : new Date().toISOString().slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const hasta = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  let q = ctx.supabase.from("financial_entries")
    .select("id, entry_date, kind, nature, category, counterparty, channel, amount, quality, source, notes")
    .eq("restaurant_id", rid).gte("entry_date", `${mes}-01`).lte("entry_date", hasta)
    .order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  if (sp.tipo && sp.tipo in NOMBRE_TIPO) q = q.eq("kind", sp.tipo);
  const { data: movs } = await q;
  const puede = ctx.puede(restaurante, "economia");
  const mover = (d: number) => new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7);
  const url = (o: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ mes, tipo: sp.tipo, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const total = (movs ?? []).reduce((a, x) => a + Number(x.amount), 0);

  return (
    <>
      <Cabecera titulo="Movimientos" subtitulo="Ingresos, compras, personal y gastos registrados a mano o importados del Excel. Cada importe importado indica su hoja y celda de origen." />

      {puede && (
        <Tarjeta className="mb-8">
          <h2 className="text-[17px] font-semibold">Nuevo movimiento</h2>
          <FormularioAccion action={crearMovimiento} boton="Guardar" className="mt-4">
            <input type="hidden" name="rid" value={rid} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Fecha" name="entry_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              <Selector label="Tipo" name="kind" defaultValue="expense">
                {(Object.keys(NOMBRE_TIPO) as TipoMovimiento[]).map((k) => <option key={k} value={k}>{NOMBRE_TIPO[k]}</option>)}
              </Selector>
              <Campo label="Concepto" name="category" required placeholder="Alquiler, Luz, Ventas sala…" />
              <Campo label="Importe" name="amount" inputMode="decimal" unidad="€" required />
              <Selector label="Naturaleza" name="nature" defaultValue="operating">
                <option value="operating">Operativo</option>
                <option value="financing">Financiación (préstamo)</option>
                <option value="investment">Inversión</option>
              </Selector>
              <Campo label="Proveedor / contraparte" name="counterparty" />
              <Selector label="Dato" name="quality" defaultValue="real"><option value="real">Real</option><option value="estimated">Estimado</option></Selector>
              <Campo label="Notas" name="notes" />
            </div>
          </FormularioAccion>
        </Tarjeta>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={url({ mes: mover(-1) })} className="rounded-full px-3 py-1.5 text-[14px] hover:bg-tinta/5">←</Link>
          <span className="text-[17px] font-semibold first-letter:uppercase">{new Date(`${mes}-01T00:00:00Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
          <Link href={url({ mes: mover(1) })} className="rounded-full px-3 py-1.5 text-[14px] hover:bg-tinta/5">→</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={url({ tipo: undefined })} className={`h-8 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${!sp.tipo ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>Todos</Link>
          {(Object.keys(NOMBRE_TIPO) as TipoMovimiento[]).map((k) => (
            <Link key={k} href={url({ tipo: k })} className={`h-8 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${sp.tipo === k ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>{NOMBRE_TIPO[k]}</Link>
          ))}
        </div>
      </div>

      {(movs?.length ?? 0) === 0 ? (
        <Vacio titulo="Sin movimientos este mes" texto="Regístralos a mano o importa el Excel de analítica." />
      ) : (
        <>
          <p className="mb-2 text-right text-[13px] text-niebla">{movs!.length} movimientos · suma {euro(total)}</p>
          <Tabla cabeceras={["Fecha", "Tipo", "Concepto", "Detalle", "Importe", "Origen", ""]}>
            {movs!.map((x) => (
              <tr key={x.id}>
                <td className="px-4 py-2.5 text-grafito">{new Date(x.entry_date).toLocaleDateString("es-ES")}</td>
                <td className="px-4 py-2.5">{NOMBRE_TIPO[x.kind as TipoMovimiento]}{x.nature !== "operating" && <span className="ml-1"><Insignia>{x.nature === "financing" ? "Financiación" : "Inversión"}</Insignia></span>}</td>
                <td className="px-4 py-2.5 font-medium">{x.category}</td>
                <td className="px-4 py-2.5 text-grafito">{x.counterparty ?? x.channel ?? ""}</td>
                <td className="px-4 py-2.5 tabular-nums">{euro(x.amount)}</td>
                <td className="px-4 py-2.5 text-[12px] text-niebla">{x.source === "excel" ? `Excel · ${x.notes}` : `Manual${x.quality === "estimated" ? " · estimado" : ""}`}</td>
                <td className="px-4 py-2.5 text-right">{puede && x.source === "manual" && <AccionRapida action={borrarMovimiento} etiqueta="Borrar" campos={{ rid, id: x.id }} />}</td>
              </tr>
            ))}
          </Tabla>
        </>
      )}
    </>
  );
}
