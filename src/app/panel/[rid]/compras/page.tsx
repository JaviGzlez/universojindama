import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Selector, Tabla, Tarjeta, Vacio, euro, SinPermiso } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { ESTADO_FACTURA } from "@/lib/compras";
import { crearFactura } from "./actions";

export const metadata = { title: "Facturas" };


export default async function Facturas({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ estado?: string }> }) {
  const { rid } = await params;
  const { estado } = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "compras")) return <SinPermiso apartado="las compras" />;
  let q = ctx.supabase.from("purchase_invoices")
    .select("id, number, invoice_date, status, total, tax_total, supplier:suppliers(name), lineas:purchase_lines(line_net, packs, pack_price, discount_pct)")
    .eq("restaurant_id", rid).order("invoice_date", { ascending: false }).limit(100);
  if (estado && estado in ESTADO_FACTURA) q = q.eq("status", estado);
  const [{ data: facturas }, { data: proveedores }] = await Promise.all([
    q,
    ctx.supabase.from("suppliers").select("id, name").eq("restaurant_id", rid).eq("status", "active").order("name"),
  ]);
  const puede = ctx.puede(restaurante, "compras");

  return (
    <>
      <Cabecera
        titulo="Facturas de compra"
        subtitulo="Borrador → validada → registrada. Solo al registrar se actualizan los precios, el inventario y los escandallos. Una factura no se puede registrar dos veces."
      />
      {puede && (
        <Tarjeta className="mb-8">
          {(proveedores?.length ?? 0) === 0 ? (
            <p className="text-[14px] text-niebla">
              Primero crea un proveedor en <Link href={`/panel/${rid}/compras/proveedores`} className="font-medium text-musgo hover:underline">Proveedores</Link>.
            </p>
          ) : (
            <FormularioAccion action={crearFactura} boton="Crear factura">
              <input type="hidden" name="rid" value={rid} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Selector label="Proveedor" name="supplier_id">
                  {proveedores!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Selector>
                <Campo label="Número de factura" name="number" required />
                <Campo label="Fecha" name="invoice_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
            </FormularioAccion>
          )}
        </Tarjeta>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={`/panel/${rid}/compras`} className={`h-8 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${!estado ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>Todas</Link>
        {(Object.keys(ESTADO_FACTURA) as (keyof typeof ESTADO_FACTURA)[]).filter((k) => k !== "void").map((k) => (
          <Link key={k} href={`/panel/${rid}/compras?estado=${k}`} className={`h-8 rounded-full px-3.5 py-1.5 text-[13px] font-medium ${estado === k ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>
            {ESTADO_FACTURA[k][0]}
          </Link>
        ))}
      </div>

      {(facturas?.length ?? 0) === 0 ? (
        <Vacio titulo="Sin facturas" texto="Registra las facturas de tus proveedores para mantener los precios y el inventario al día." />
      ) : (
        <Tabla cabeceras={["Fecha", "Proveedor", "Número", "Líneas", "Neto", "Estado"]}>
          {facturas!.map((f) => {
            const lineas = (f.lineas ?? []) as { line_net: string | null; packs: string; pack_price: string; discount_pct: string }[];
            const neto = lineas.reduce((a, l) => a + (l.line_net !== null ? Number(l.line_net) : Number(l.packs) * Number(l.pack_price) * (1 - Number(l.discount_pct) / 100)), 0);
            const e = ESTADO_FACTURA[f.status as keyof typeof ESTADO_FACTURA];
            return (
              <tr key={f.id} className="hover:bg-crema/60">
                <td className="px-5 py-3.5 text-grafito">{new Date(f.invoice_date).toLocaleDateString("es-ES")}</td>
                <td className="px-5 py-3.5 font-medium">{(f.supplier as unknown as { name: string } | null)?.name ?? "—"}</td>
                <td className="px-5 py-3.5"><Link href={`/panel/${rid}/compras/${f.id}`} className="font-medium text-musgo hover:underline">{f.number}</Link></td>
                <td className="px-5 py-3.5 text-grafito">{lineas.length}</td>
                <td className="px-5 py-3.5 tabular-nums">{euro(neto)}</td>
                <td className="px-5 py-3.5"><Insignia tono={e[1]}>{e[0]}</Insignia></td>
              </tr>
            );
          })}
        </Tabla>
      )}
    </>
  );
}
