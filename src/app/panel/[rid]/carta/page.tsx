import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Selector, Tarjeta, Vacio, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarAjustes, cargarImpuestos } from "@/lib/datos";
import { calcularVersion, cargarCatalogo, cargarVersion, type Version } from "@/lib/recetas";
import { archivar } from "../actions";
import { crearCanal, crearPlato, enlazarReceta, fijarPrecio } from "./actions";

export const metadata = { title: "Carta y canales" };

const TIPO = { dine_in: "Sala", takeaway: "Recogida", own_delivery: "Reparto propio", platform: "Plataforma" } as const;

export default async function Carta({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const hoy = new Date().toISOString().slice(0, 10);
  const [{ data: canales }, { data: platos }, { data: precios }, { cat, recetas }, impuestos, ajustes] = await Promise.all([
    sb.from("sales_channels").select("*").eq("restaurant_id", rid).eq("status", "active").order("created_at"),
    sb.from("menu_items").select("id, name, category, recipe_id, version").eq("restaurant_id", rid).eq("status", "active").order("category").order("name"),
    sb.from("channel_prices").select("menu_item_id, channel_id, pvp, pvp_includes_tax, tax_rate, valid_from").eq("restaurant_id", rid).lte("valid_from", hoy).order("valid_from", { ascending: false }),
    cargarCatalogo(sb, rid, restaurante.organization_id),
    cargarImpuestos(sb, rid),
    cargarAjustes(sb, rid),
  ]);
  const puedeCanal = ctx.puede(restaurante, "ajustes");
  const puedePlato = ctx.puede(restaurante, "equipos") || puedeCanal;
  const objetivo = ajustes?.targets?.target_food_cost_pct ?? null;
  const platosReceta = recetas.filter((x) => x.kind === "dish");
  const ivaVenta = impuestos.find((x) => x.kind === "sale");

  // precio vigente por plato y canal (el más reciente con fecha ≤ hoy)
  const vigente = new Map<string, NonNullable<typeof precios>[number]>();
  for (const p of precios ?? []) {
    const k = `${p.menu_item_id}|${p.channel_id}`;
    if (!vigente.has(k)) vigente.set(k, p);
  }

  // rentabilidad: receta activa de cada plato con cada canal
  const versiones = new Map<string, Version>();
  await Promise.all([...new Set((platos ?? []).map((p) => p.recipe_id).filter(Boolean))].map(async (recId) => {
    const rec = recetas.find((x) => x.id === recId);
    if (rec?.active_version_id) {
      const v = await cargarVersion(sb, rec.active_version_id);
      if (v) versiones.set(rec.id, v);
    }
  }));
  const celda = (plato: { recipe_id: string | null }, canal: NonNullable<typeof canales>[number], precio: NonNullable<typeof precios>[number] | undefined) => {
    const rec = plato.recipe_id ? recetas.find((x) => x.id === plato.recipe_id) : undefined;
    const v = rec ? versiones.get(rec.id) : undefined;
    if (!rec || !v || !precio) return null;
    const { result } = calcularVersion(v, rec, cat, {
      name: canal.name, pvp: precio.pvp, pvpIncludesTax: precio.pvp_includes_tax, taxRate: precio.tax_rate,
      commissionPct: canal.commission_pct, commissionBase: canal.commission_base, fixedFeePerOrder: canal.fixed_fee_per_order,
      portionsPerOrder: canal.portions_per_order, packagingPerPortion: canal.packaging_per_portion,
    });
    const neto = result.profitability.net_sale_price ? Number(result.profitability.net_sale_price) : null;
    const mp = result.costs.ingredients ? Number(result.costs.ingredients) : null;
    return {
      margen: result.profitability.contribution_margin, margenPct: result.profitability.contribution_margin_pct,
      foodCost: neto && mp !== null && neto > 0 ? (mp / neto) * 100 : null, estado: result.status,
    };
  };

  return (
    <>
      <Cabecera
        titulo="Carta y canales"
        subtitulo="Precio por plato y canal, con su margen de contribución tras comisiones y envases. Los precios tienen fecha de vigencia y conservan el histórico."
      />

      <section className="mb-10">
        <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-niebla">Canales de venta</h2>
        <div className="flex flex-wrap gap-3">
          {(canales ?? []).map((c) => (
            <div key={c.id} className="rounded-2xl bg-white px-4 py-3 ring-1 ring-linea">
              <p className="text-[15px] font-semibold">{c.name} <span className="font-normal text-niebla">· {TIPO[c.kind as keyof typeof TIPO]}</span></p>
              <p className="text-[12px] text-niebla">
                {Number(c.commission_pct) ? `${numero(Number(c.commission_pct) * 100)} % sobre ${c.commission_base === "net" ? "neto" : "bruto"}` : "Sin comisión"}
                {Number(c.fixed_fee_per_order) ? ` · ${euro(c.fixed_fee_per_order)}/pedido` : ""}
                {Number(c.packaging_per_portion) ? ` · envase ${euro(c.packaging_per_portion)}` : ""}
              </p>
              {puedeCanal && <AccionRapida action={archivar} etiqueta="Archivar" campos={{ restaurant_id: rid, tabla: "sales_channels", id: c.id, version: c.version, ruta: "/carta" }} />}
            </div>
          ))}
        </div>
        {puedeCanal && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-medium text-musgo">Añadir canal</summary>
            <Tarjeta className="mt-3">
              <FormularioAccion action={crearCanal} boton="Guardar canal">
                <input type="hidden" name="rid" value={rid} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Campo label="Nombre" name="name" required placeholder="Glovo" />
                  <Selector label="Tipo" name="kind" defaultValue="dine_in">
                    {Object.entries(TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Selector>
                  <Campo label="Comisión" name="commission_pct" inputMode="decimal" unidad="%" defaultValue="0" />
                  <Selector label="Base de la comisión" name="commission_base" defaultValue="gross">
                    <option value="gross">Importe con impuestos</option><option value="net">Importe neto</option>
                  </Selector>
                  <Campo label="Comisión fija por pedido" name="fixed_fee_per_order" inputMode="decimal" unidad="€" defaultValue="0" />
                  <Campo label="Raciones medias por pedido" name="portions_per_order" inputMode="decimal" defaultValue="1" />
                  <Campo label="Envase por ración" name="packaging_per_portion" inputMode="decimal" unidad="€" defaultValue="0" />
                  <Campo label="Notas (base contractual)" name="notes" />
                </div>
              </FormularioAccion>
            </Tarjeta>
          </details>
        )}
      </section>

      {puedePlato && (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <Tarjeta>
            <h2 className="text-[17px] font-semibold">Añadir plato a la carta</h2>
            <FormularioAccion action={crearPlato} boton="Añadir" className="mt-4">
              <input type="hidden" name="rid" value={rid} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Nombre en carta" name="name" required />
                <Campo label="Categoría" name="category" />
                <Selector label="Receta" name="recipe_id" defaultValue="" className="sm:col-span-2">
                  <option value="">Sin receta (no calcula margen)</option>
                  {platosReceta.map((x) => <option key={x.id} value={x.id}>{x.name}{x.active_version_id ? "" : " · sin activar"}</option>)}
                </Selector>
              </div>
            </FormularioAccion>
          </Tarjeta>
          {(canales?.length ?? 0) > 0 && (platos?.length ?? 0) > 0 && puedeCanal && (
            <Tarjeta>
              <h2 className="text-[17px] font-semibold">Fijar precio</h2>
              <FormularioAccion action={fijarPrecio} boton="Guardar precio" className="mt-4">
                <input type="hidden" name="rid" value={rid} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Selector label="Plato" name="menu_item_id">{platos!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Selector>
                  <Selector label="Canal" name="channel_id">{canales!.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Selector>
                  <Campo label="PVP" name="pvp" inputMode="decimal" unidad="€" required />
                  <Campo label="IVA" name="tax_pct" inputMode="decimal" unidad="%" defaultValue={ivaVenta ? String(Number(ivaVenta.rate) * 100) : "10"} />
                  <Selector label="El PVP" name="pvp_includes_tax" defaultValue="si"><option value="si">Incluye IVA</option><option value="no">Sin IVA</option></Selector>
                  <Campo label="Vigente desde" name="valid_from" type="date" defaultValue={hoy} />
                </div>
              </FormularioAccion>
            </Tarjeta>
          )}
        </div>
      )}

      {(platos?.length ?? 0) === 0 ? (
        <Vacio titulo="Carta vacía" texto="Añade los platos que vendes y enlázalos con su receta para ver el margen por canal." />
      ) : (
        <div className="overflow-x-auto rounded-[22px] bg-white ring-1 ring-linea">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-linea text-[12px] uppercase tracking-[0.06em] text-niebla">
                <th className="px-5 py-3.5 font-medium">Plato</th>
                {(canales ?? []).map((c) => <th key={c.id} className="px-5 py-3.5 font-medium">{c.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-linea/70">
              {platos!.map((p) => {
                const rec = p.recipe_id ? recetas.find((x) => x.id === p.recipe_id) : undefined;
                return (
                  <tr key={p.id} className="align-top">
                    <td className="px-5 py-4">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-[12px] text-niebla">
                        {p.category ?? "Sin categoría"} ·{" "}
                        {rec ? <Link href={`/panel/${rid}/recetas/${rec.id}`} className="text-musgo hover:underline">{rec.name}</Link> : "sin receta"}
                      </p>
                      {!rec && puedePlato && platosReceta.length > 0 && (
                        <FormularioAccion action={enlazarReceta} boton="Enlazar" limpiar={false} className="mt-2 flex items-end gap-2 [&>div]:mt-0">
                          <input type="hidden" name="rid" value={rid} /><input type="hidden" name="id" value={p.id} />
                          <Selector label="" name="recipe_id" aria-label="Receta">{platosReceta.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Selector>
                        </FormularioAccion>
                      )}
                    </td>
                    {(canales ?? []).map((c) => {
                      const precio = vigente.get(`${p.id}|${c.id}`);
                      const x = celda(p, c, precio);
                      const alto = x?.foodCost !== null && x?.foodCost !== undefined && objetivo !== null && x.foodCost > objetivo;
                      return (
                        <td key={c.id} className="px-5 py-4">
                          {precio ? (
                            <>
                              <p className="font-semibold tabular-nums">{euro(precio.pvp)}</p>
                              {x ? (
                                <p className="mt-0.5 text-[12px] text-grafito">
                                  Margen {x.margen ? euro(x.margen) : "—"}{x.margenPct ? ` · ${numero(x.margenPct, 1)} %` : ""}
                                  <br />
                                  <span className={alto ? "font-medium text-terracota" : "text-niebla"}>
                                    Materia prima {x.foodCost === null ? "—" : `${numero(x.foodCost, 1)} %`}{alto ? " ▲" : ""}
                                  </span>
                                  {x.estado !== "complete" && <span className="ml-1"><Insignia tono={x.estado === "incomplete" ? "pendiente" : "estimado"}>{x.estado === "incomplete" ? "Incompleto" : "Estimado"}</Insignia></span>}
                                </p>
                              ) : <p className="text-[12px] text-niebla">{rec ? "Receta sin activar" : "Sin receta"}</p>}
                            </>
                          ) : <span className="text-niebla">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {objetivo !== null && <p className="mt-3 text-[12px] text-niebla">▲ Materia prima por encima del objetivo del {numero(objetivo)} % sobre la venta neta.</p>}
    </>
  );
}
