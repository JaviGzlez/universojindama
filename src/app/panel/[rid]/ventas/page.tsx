import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Selector, Tabla, Tarjeta, Vacio, claseInput, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { borrarVenta, importarVentas, registrarVenta } from "./actions";

export const metadata = { title: "Ventas" };

export default async function Ventas({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { rid } = await params;
  const { mes } = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const ahora = new Date();
  const m = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : ahora.toISOString().slice(0, 7);
  const desde = `${m}-01`;
  const [y, mo] = m.split("-").map(Number);
  const hasta = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const [{ data: platos }, { data: canales }, { data: resumen }, { data: recientes }] = await Promise.all([
    sb.from("menu_items").select("id, name").eq("restaurant_id", rid).eq("status", "active").order("name"),
    sb.from("sales_channels").select("id, name").eq("restaurant_id", rid).eq("status", "active"),
    sb.rpc("sales_summary", { p_restaurants: [rid], p_from: desde, p_to: hasta }),
    sb.from("sales").select("id, sale_date, quantity, gross_amount, source, menu_item_id, channel_id").eq("restaurant_id", rid).gte("sale_date", desde).lte("sale_date", hasta).order("sale_date", { ascending: false }).order("created_at", { ascending: false }).limit(50),
  ]);
  const nombre = new Map((platos ?? []).map((p) => [p.id, p.name]));
  const canal = new Map((canales ?? []).map((c) => [c.id, c.name]));
  const porPlato = new Map<string, { cantidad: number; importe: number }>();
  for (const x of (resumen ?? []) as { menu_item_id: string; quantity: string; gross: string | null }[]) {
    const a = porPlato.get(x.menu_item_id) ?? { cantidad: 0, importe: 0 };
    a.cantidad += Number(x.quantity);
    a.importe += Number(x.gross ?? 0);
    porPlato.set(x.menu_item_id, a);
  }
  const ranking = [...porPlato.entries()].sort((a, b) => b[1].cantidad - a[1].cantidad);
  const maxCant = Math.max(1, ...ranking.map((x) => x[1].cantidad));
  const puede = ctx.puede(restaurante, "ajustes");
  const mesTxt = new Date(`${m}-01T00:00:00Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
  const mover = (d: number) => new Date(Date.UTC(y, mo - 1 + d, 1)).toISOString().slice(0, 7);

  return (
    <>
      <Cabecera
        titulo="Ventas por plato"
        subtitulo="Unidades vendidas por plato y canal. Sirven para el consumo teórico del inventario y para ver qué se vende. Los ingresos totales del restaurante se llevan en Economía."
      />
      {puede && (platos?.length ?? 0) > 0 && (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <Tarjeta>
            <h2 className="text-[17px] font-semibold">Registrar venta</h2>
            <FormularioAccion action={registrarVenta} boton="Registrar" className="mt-4">
              <input type="hidden" name="rid" value={rid} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Fecha" name="sale_date" type="date" defaultValue={ahora.toISOString().slice(0, 10)} required />
                <Selector label="Plato" name="menu_item_id">{platos!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Selector>
                <Selector label="Canal" name="channel_id" defaultValue=""><option value="">Sin canal</option>{(canales ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Selector>
                <Campo label="Unidades" name="quantity" inputMode="decimal" required />
                <Campo label="Importe cobrado (con IVA)" name="gross_amount" inputMode="decimal" unidad="€" className="sm:col-span-2" />
              </div>
            </FormularioAccion>
          </Tarjeta>
          <Tarjeta>
            <h2 className="text-[17px] font-semibold">Importar CSV del TPV</h2>
            <p className="mt-1 text-[13px] text-niebla">Columnas: <code>fecha;plato;canal;cantidad;importe</code>. Los nombres deben coincidir con la carta y los canales. Si alguna línea falla, no se importa nada; reimportar el mismo archivo no duplica.</p>
            <FormularioAccion action={importarVentas} boton="Importar" className="mt-4">
              <input type="hidden" name="rid" value={rid} />
              <input type="file" name="archivo" accept=".csv,text/csv,text/plain" className="block w-full text-[13px] file:mr-3 file:rounded-full file:border-0 file:bg-crema-2 file:px-4 file:py-2 file:text-[13px] file:font-medium" />
              <textarea name="texto" rows={4} placeholder={"o pega aquí:\n01/11/2026;Croquetas;Sala;12;96,00"} className={`${claseInput} mt-3 h-auto py-3 font-mono text-[12px]`} />
            </FormularioAccion>
          </Tarjeta>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <a href={`?mes=${mover(-1)}`} className="rounded-full px-3 py-1.5 text-[14px] font-medium hover:bg-tinta/5">←</a>
        <h2 className="text-[20px] font-semibold first-letter:uppercase">{mesTxt}</h2>
        <a href={`?mes=${mover(1)}`} className="rounded-full px-3 py-1.5 text-[14px] font-medium hover:bg-tinta/5">→</a>
      </div>

      {ranking.length === 0 ? (
        <Vacio titulo="Sin ventas este mes" texto={(platos?.length ?? 0) === 0 ? "Primero añade platos en Carta." : "Registra o importa ventas para ver el ranking."} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Tarjeta>
            <h3 className="mb-4 text-[17px] font-semibold">Más vendidos</h3>
            <ul className="space-y-3">
              {ranking.slice(0, 12).map(([id, x]) => (
                <li key={id}>
                  <div className="mb-1 flex justify-between text-[14px]"><span className="font-medium">{nombre.get(id) ?? "—"}</span><span className="tabular-nums text-grafito">{numero(x.cantidad)} uds{x.importe ? ` · ${euro(x.importe)}` : ""}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-crema-2"><div className="h-full rounded-full bg-musgo transition-[width] duration-700" style={{ width: `${(x.cantidad / maxCant) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </Tarjeta>
          <div>
            <h3 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-niebla">Últimos registros</h3>
            <Tabla cabeceras={["Fecha", "Plato", "Canal", "Uds", "Importe", ""]}>
              {(recientes ?? []).map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-2.5 text-grafito">{new Date(v.sale_date).toLocaleDateString("es-ES")}</td>
                  <td className="px-4 py-2.5">{nombre.get(v.menu_item_id) ?? "—"}</td>
                  <td className="px-4 py-2.5 text-grafito">{v.channel_id ? canal.get(v.channel_id) : "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{numero(v.quantity)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{v.gross_amount ? euro(v.gross_amount) : "—"}</td>
                  <td className="px-4 py-2.5 text-right">{puede && <AccionRapida action={borrarVenta} etiqueta="Borrar" campos={{ rid, id: v.id }} />}</td>
                </tr>
              ))}
            </Tabla>
          </div>
        </div>
      )}
    </>
  );
}
