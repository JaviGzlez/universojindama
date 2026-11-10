import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Campo, Insignia, Selector, Tabla, Tarjeta, euro, numero, SinPermiso } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarIngredientes } from "@/lib/datos";
import { anadirLinea, borrarFactura, guardarCabecera, quitarLinea, reabrirFactura, registrarFactura, validarFactura } from "../actions";
import { ESTADO_FACTURA } from "@/lib/compras";

export const metadata = { title: "Factura" };

const REF = { g: [1000, "kg"], ml: [1000, "l"], unit: [1, "ud"] } as const;

export default async function FacturaDetalle({ params }: { params: Promise<{ rid: string; id: string }> }) {
  const { rid, id } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "compras")) return <SinPermiso apartado="las compras" />;
  const sb = ctx.supabase;
  const { data: f } = await sb.from("purchase_invoices")
    .select("id, number, invoice_date, status, discount_total, shipping, tax_total, total, notes, version, supplier_id, posted_at, supplier:suppliers(name)")
    .eq("id", id).eq("restaurant_id", rid).maybeSingle();
  if (!f) notFound();
  const [{ data: lineas }, { data: productos }, ings, { data: impuestos }] = await Promise.all([
    sb.from("purchase_lines").select("id, description, ingredient_id, packs, pack_quantity, pack_unit, pack_price, discount_pct, tax_rate, base_quantity, price_per_base_unit, line_net").eq("invoice_id", id).order("position"),
    sb.from("supplier_products").select("id, description, brand, pack_quantity, pack_unit, last_price, ingredient_id").eq("supplier_id", f.supplier_id).eq("status", "active").order("description"),
    cargarIngredientes(sb, rid, restaurante.organization_id),
    sb.from("tax_rates").select("rate, name").eq("restaurant_id", rid).eq("kind", "purchase").eq("status", "active"),
  ]);
  const ing = new Map(ings.map((i) => [i.id, i]));
  const editable = f.status === "draft" || f.status === "review";
  const puede = ctx.puede(restaurante, "compras");
  const e = ESTADO_FACTURA[f.status as keyof typeof ESTADO_FACTURA];
  const bruto = (lineas ?? []).reduce((a, l) => a + Number(l.packs) * Number(l.pack_price) * (1 - Number(l.discount_pct) / 100), 0);
  const neto = bruto - Number(f.discount_total) + Number(f.shipping);
  const iva = (lineas ?? []).reduce((a, l) => a + Number(l.packs) * Number(l.pack_price) * (1 - Number(l.discount_pct) / 100) * Number(l.tax_rate), 0);
  const ivaDefecto = impuestos?.[0] ? String(Number(impuestos[0].rate) * 100) : "10";

  return (
    <>
      <Link href={`/panel/${rid}/compras`} className="text-[13px] font-medium text-niebla hover:text-tinta">← Facturas</Link>
      <div className="mb-8 mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-niebla">{(f.supplier as unknown as { name: string } | null)?.name}</p>
          <h1 className="mt-1 flex items-center gap-3 text-[36px] font-semibold tracking-[-0.03em]">Factura {f.number} <Insignia tono={e[1]}>{e[0]}</Insignia></h1>
        </div>
        {puede && (
          <div className="flex flex-wrap items-center gap-3">
            {editable && <AccionRapida action={borrarFactura} etiqueta="Borrar" confirmar="¿Borrar esta factura sin validar?" campos={{ rid, id }} />}
            {f.status === "validated" && <AccionRapida action={reabrirFactura} etiqueta="Reabrir para corregir" campos={{ rid, id }} />}
            {editable && (
              <FormularioAccion action={validarFactura} boton="Validar" limpiar={false} className="[&>div]:mt-0">
                <input type="hidden" name="rid" value={rid} /><input type="hidden" name="id" value={id} />
              </FormularioAccion>
            )}
            {f.status === "validated" && (
              <FormularioAccion action={registrarFactura} boton="Registrar y aplicar" limpiar={false} className="[&>div]:mt-0">
                <input type="hidden" name="rid" value={rid} /><input type="hidden" name="id" value={id} />
              </FormularioAccion>
            )}
          </div>
        )}
      </div>

      {f.status === "posted" && (
        <p className="mb-6 rounded-2xl bg-musgo-claro px-5 py-4 text-[14px] text-musgo">
          Registrada el {new Date(f.posted_at!).toLocaleString("es-ES", { timeZone: restaurante.timezone })}. Los precios y el inventario ya se aplicaron; la factura ya no se puede modificar.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {editable && puede && (
            <Tarjeta>
              <h2 className="text-[17px] font-semibold">Añadir línea</h2>
              <FormularioAccion action={anadirLinea} boton="Añadir línea" className="mt-4">
                <input type="hidden" name="rid" value={rid} /><input type="hidden" name="invoice_id" value={id} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {(productos?.length ?? 0) > 0 && (
                    <Selector label="Producto del proveedor" name="supplier_product_id" defaultValue="" className="sm:col-span-2" ayuda="Rellena formato y materia prima automáticamente.">
                      <option value="">— Otro (rellenar a mano) —</option>
                      {productos!.map((p) => (
                        <option key={p.id} value={p.id}>{p.description}{p.brand ? ` · ${p.brand}` : ""} ({numero(p.pack_quantity)} {p.pack_unit}){p.last_price ? ` · último ${euro(p.last_price)}` : ""}</option>
                      ))}
                    </Selector>
                  )}
                  <Selector label="Materia prima" name="ingredient_id" defaultValue="" className="sm:col-span-2">
                    <option value="">{(productos?.length ?? 0) > 0 ? "— la del producto —" : "Elige…"}</option>
                    {ings.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </Selector>
                  <Campo label="Descripción" name="description" placeholder="Garrafa 5 l" className="sm:col-span-2" />
                  <Campo label="Envases" name="packs" inputMode="decimal" required defaultValue="1" />
                  <Campo label="Precio por envase (sin IVA)" name="pack_price" inputMode="decimal" unidad="€" required />
                  <Campo label="Contenido por envase" name="pack_quantity" inputMode="decimal" />
                  <Selector label="Unidad" name="pack_unit" defaultValue="kg">
                    <option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="unit">ud</option>
                  </Selector>
                  <Campo label="Descuento" name="discount_pct" inputMode="decimal" unidad="%" defaultValue="0" />
                  <Campo label="IVA" name="tax_pct" inputMode="decimal" unidad="%" defaultValue={ivaDefecto} />
                </div>
              </FormularioAccion>
            </Tarjeta>
          )}

          <Tabla cabeceras={["Línea", "Envases", "Precio", "Dto.", "Importe", "Precio aplicado", ""]}>
            {(lineas ?? []).map((l) => {
              const i = l.ingredient_id ? ing.get(l.ingredient_id) : undefined;
              const ref = i ? REF[i.base_unit] : null;
              return (
                <tr key={l.id}>
                  <td className="px-5 py-3.5">
                    <p className="font-medium">{l.description}</p>
                    <p className="text-[12px] text-niebla">{i?.name ?? "Sin materia prima"} · {numero(l.pack_quantity)} {l.pack_unit} por envase</p>
                  </td>
                  <td className="px-5 py-3.5 tabular-nums">{numero(l.packs)}</td>
                  <td className="px-5 py-3.5 tabular-nums">{euro(l.pack_price, 2)}</td>
                  <td className="px-5 py-3.5 tabular-nums text-grafito">{Number(l.discount_pct) ? `${numero(l.discount_pct)} %` : "—"}</td>
                  <td className="px-5 py-3.5 tabular-nums">{euro(Number(l.packs) * Number(l.pack_price) * (1 - Number(l.discount_pct) / 100))}</td>
                  <td className="px-5 py-3.5 tabular-nums">
                    {l.price_per_base_unit && ref ? <span className="font-medium">{euro(Number(l.price_per_base_unit) * ref[0], 3)} / {ref[1]}</span> : <span className="text-niebla">al validar</span>}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {editable && puede && <AccionRapida action={quitarLinea} etiqueta="Quitar" campos={{ rid, id: l.id, invoice_id: id }} />}
                  </td>
                </tr>
              );
            })}
          </Tabla>
          {(lineas?.length ?? 0) === 0 && <p className="text-center text-[14px] text-niebla">Añade las líneas de la factura.</p>}
        </div>

        <aside className="space-y-4">
          <Tarjeta>
            <h2 className="text-[17px] font-semibold">Totales</h2>
            <dl className="mt-4 space-y-2 text-[14px]">
              <div className="flex justify-between"><dt className="text-grafito">Líneas</dt><dd className="tabular-nums">{euro(bruto)}</dd></div>
              <div className="flex justify-between"><dt className="text-grafito">Descuento cabecera</dt><dd className="tabular-nums">−{euro(f.discount_total)}</dd></div>
              <div className="flex justify-between"><dt className="text-grafito">Portes</dt><dd className="tabular-nums">{euro(f.shipping)}</dd></div>
              <div className="flex justify-between border-t border-linea pt-2 font-medium"><dt>Neto</dt><dd className="tabular-nums">{euro(neto)}</dd></div>
              <div className="flex justify-between"><dt className="text-grafito">IVA calculado</dt><dd className="tabular-nums">{euro(iva)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums">{euro(neto + iva)}</dd></div>
              {f.total !== null && (
                <div className={`mt-2 rounded-xl px-3 py-2 text-[13px] ${Math.abs(Number(f.total) - (neto + iva)) < 0.05 ? "bg-musgo-claro text-musgo" : "bg-ambar-claro text-ambar"}`}>
                  Total del documento: {euro(f.total)} {Math.abs(Number(f.total) - (neto + iva)) < 0.05 ? "· cuadra" : "· no cuadra, revisa"}
                </div>
              )}
            </dl>
            <p className="mt-3 text-[12px] text-niebla">El descuento de cabecera y los portes se reparten entre las líneas según su importe al validar.</p>
          </Tarjeta>
          {editable && puede && (
            <Tarjeta>
              <h2 className="text-[17px] font-semibold">Cabecera</h2>
              <FormularioAccion action={guardarCabecera} boton="Guardar" limpiar={false} className="mt-4">
                <input type="hidden" name="rid" value={rid} /><input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={f.version} />
                <div className="space-y-3">
                  <Campo label="Número" name="number" defaultValue={f.number} required />
                  <Campo label="Fecha" name="invoice_date" type="date" defaultValue={f.invoice_date} required />
                  <Campo label="Descuento de cabecera" name="discount_total" inputMode="decimal" unidad="€" defaultValue={String(f.discount_total)} />
                  <Campo label="Portes" name="shipping" inputMode="decimal" unidad="€" defaultValue={String(f.shipping)} />
                  <Campo label="Total del documento (con IVA)" name="total" inputMode="decimal" unidad="€" defaultValue={f.total ?? ""} ayuda="Para comprobar que cuadra." />
                  <Campo label="Notas" name="notes" defaultValue={f.notes ?? ""} />
                </div>
              </FormularioAccion>
            </Tarjeta>
          )}
        </aside>
      </div>
    </>
  );
}
