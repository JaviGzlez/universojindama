import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { COLOR_SERIE, GraficoMensual } from "@/components/graficos";
import { mundoDeSlug } from "@/components/mundo";
import { CasillasAlergenos, Campo, Insignia, Selector, Tabla, Tarjeta, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { editarIngrediente, registrarPrecio } from "../../actions";

export const metadata = { title: "Materia prima" };

const REF = { g: [1000, "kg"], ml: [1000, "l"], unit: [1, "ud"] } as const;
const KIND = { purchase: "Compra", waste: "Merma", adjustment: "Ajuste", transfer_in: "Traspaso (entrada)", transfer_out: "Traspaso (salida)", production_in: "Producción (entrada)", production_out: "Producción (consumo)" } as Record<string, string>;

export default async function FichaMateria({ params }: { params: Promise<{ rid: string; id: string }> }) {
  const { rid, id } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const { data: i } = await sb.from("ingredients")
    .select("id, restaurant_id, name, category, base_unit, yield_ratio, density_g_per_ml, unit_weight_g, unit_volume_ml, storage, allergens, source, version")
    .eq("id", id).maybeSingle();
  if (!i) notFound();
  const [ref, unidadRef] = REF[i.base_unit as keyof typeof REF];
  const verCompras = ctx.puedeVer(restaurante, "compras");
  const verInv = ctx.puedeVer(restaurante, "inventario");
  const verRecetas = ctx.puedeVer(restaurante, "recetas");

  const [{ data: precios }, prods, usos, movs, stock, lineas] = await Promise.all([
    sb.from("ingredient_prices").select("price_per_base_unit, valid_from, source, notes, created_at").eq("restaurant_id", rid).eq("ingredient_id", id).order("valid_from", { ascending: true }).limit(500),
    verCompras ? sb.from("supplier_products").select("id, description, brand, pack_quantity, pack_unit, last_price, last_price_date, supplier:suppliers(name)").eq("restaurant_id", rid).eq("ingredient_id", id).eq("status", "active") : Promise.resolve({ data: [] }),
    verRecetas ? sb.from("recipe_ingredients").select("quantity, unit, quantity_type, recipe_versions!inner(status, recipes!inner(id, name, kind))").eq("restaurant_id", rid).eq("ingredient_id", id).eq("recipe_versions.status", "active") : Promise.resolve({ data: [] }),
    verInv ? sb.from("stock_movements").select("id, kind, quantity, occurred_at, notes, reference").eq("restaurant_id", rid).eq("ingredient_id", id).order("occurred_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    verInv ? sb.rpc("stock_on_hand", { p_restaurant: rid }) : Promise.resolve({ data: [] }),
    verCompras ? sb.from("purchase_lines").select("packs, pack_quantity, pack_unit, pack_price, price_per_base_unit, invoice:purchase_invoices!inner(id, number, invoice_date, status, supplier:suppliers(name))").eq("restaurant_id", rid).eq("ingredient_id", id).eq("invoice.status", "posted").limit(20) : Promise.resolve({ data: [] }),
  ]);
  const historial = precios ?? [];
  const actual = historial.length ? Number(historial[historial.length - 1].price_per_base_unit) * ref : null;
  const primero = historial.length ? Number(historial[0].price_per_base_unit) * ref : null;
  const variacion = actual !== null && primero ? ((actual - primero) / primero) * 100 : null;
  // un punto por mes (último precio del mes) para la gráfica
  const porMes = new Map<string, number>();
  for (const p of historial) porMes.set(`${p.valid_from.slice(0, 7)}-01`, Number(p.price_per_base_unit) * ref);
  const puntos = [...porMes.entries()].slice(-12).map(([mes, valor]) => ({ mes, valor }));
  const existencias = ((stock.data ?? []) as { ingredient_id: string; quantity: string }[]).find((x) => x.ingredient_id === id);
  const mermas = ((movs.data ?? []) as { kind: string; quantity: string }[]).filter((m) => m.kind === "waste").reduce((a, m) => a + Math.abs(Number(m.quantity)), 0);
  const puede = ctx.puede(restaurante, "materias");
  const puedePrecio = puede || ctx.puede(restaurante, "compras");
  const fmtQ = (q: number) => (i.base_unit === "unit" ? `${numero(q, 1)} ud` : `${numero(q / 1000, 2)} ${unidadRef}`);
  const usosL = (usos.data ?? []) as unknown as { quantity: string; unit: string; quantity_type: string; recipe_versions: { recipes: { id: string; name: string; kind: string } } }[];

  return (
    <>
      <Link href={`/panel/${rid}/ingredientes`} className="text-[13px] font-medium text-niebla hover:text-tinta">← Materias primas</Link>
      <div className="mb-8 mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-niebla">{i.category ?? "Materia prima"}{i.restaurant_id === null ? " · compartida con el grupo" : ""}</p>
          <h1 className="mt-1 text-[36px] font-semibold leading-tight tracking-[-0.03em] md:text-[44px]">{i.name}</h1>
          {(i.allergens ?? []).length > 0 && <p className="mt-2 text-[14px] capitalize text-terracota">{(i.allergens as string[]).join(" · ")}</p>}
        </div>
        <div className="text-right">
          <p className="text-[13px] text-niebla">Precio vigente</p>
          <p className="text-[36px] font-semibold tabular-nums tracking-[-0.02em]">{actual === null ? "—" : `${euro(actual)}`}<span className="text-[16px] font-normal text-niebla"> / {unidadRef}</span></p>
          {variacion !== null && Math.abs(variacion) >= 0.1 && (
            <p className={`text-[13px] ${variacion > 0 ? "text-terracota" : "text-musgo"}`}>{variacion > 0 ? "▲" : "▼"} {numero(Math.abs(variacion), 1)} % desde el primer precio</p>
          )}
        </div>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Rendimiento", `${numero(Number(i.yield_ratio) * 100, 1)} %`],
          ["Existencias", verInv ? (existencias ? fmtQ(Number(existencias.quantity)) : "—") : "Sin permiso"],
          ["Mermas recientes", verInv ? (mermas ? fmtQ(mermas) : "—") : "Sin permiso"],
          ["Usada en", verRecetas ? `${new Set(usosL.map((u) => u.recipe_versions.recipes.id)).size} recetas` : "Sin permiso"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[20px] bg-white p-5 ring-1 ring-linea"><dt className="text-[13px] text-niebla">{k}</dt><dd className="mt-1 text-[22px] font-semibold">{v}</dd></div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Tarjeta>
          <h2 className="text-[17px] font-semibold">Evolución del precio</h2>
          <div className="mt-3">
            <GraficoMensual puntos={puntos} color={COLOR_SERIE[mundoDeSlug(restaurante.slug)]} etiqueta={`Precio por ${unidadRef}`} alto={220} />
          </div>
          <ul className="mt-4 max-h-56 divide-y divide-linea/70 overflow-y-auto text-[13px]">
            {[...historial].reverse().slice(0, 20).map((p, k) => (
              <li key={k} className="flex justify-between gap-3 py-2">
                <span className="text-grafito">{new Date(p.valid_from).toLocaleDateString("es-ES")} · {p.source === "invoice" ? "factura" : p.source === "import" ? "importado" : "manual"}{p.notes ? ` · ${p.notes}` : ""}</span>
                <span className="shrink-0 font-medium tabular-nums">{euro(Number(p.price_per_base_unit) * ref, 3)}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
        <div className="space-y-6">
          {puedePrecio && (
            <Tarjeta>
              <h2 className="text-[17px] font-semibold">Nuevo precio</h2>
              <p className="mt-1 text-[13px] text-niebla">Se recalculan solas las recetas que la usan.</p>
              <FormularioAccion action={registrarPrecio} boton="Registrar precio" className="mt-4">
                <input type="hidden" name="restaurant_id" value={rid} /><input type="hidden" name="ingredient_id" value={id} />
                <div className="grid grid-cols-2 gap-3">
                  <Campo label="Precio sin IVA" name="importe" inputMode="decimal" unidad="€" required className="col-span-2" />
                  <Campo label="Por cantidad" name="cantidad" inputMode="decimal" defaultValue="1" required />
                  <Selector label="Unidad" name="unidad" defaultValue={i.base_unit === "unit" ? "unit" : i.base_unit === "g" ? "kg" : "l"}>
                    <option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="unit">ud</option>
                  </Selector>
                </div>
              </FormularioAccion>
            </Tarjeta>
          )}
          {verCompras && (
            <Tarjeta>
              <h2 className="text-[17px] font-semibold">Proveedores</h2>
              {((prods.data ?? []) as unknown[]).length === 0 ? (
                <p className="mt-2 text-[13px] text-niebla">Ningún producto de proveedor enlazado. <Link href={`/panel/${rid}/compras/proveedores`} className="font-medium text-musgo hover:underline">Añadir</Link></p>
              ) : (
                <ul className="mt-3 space-y-2 text-[14px]">
                  {((prods.data ?? []) as unknown as { id: string; description: string; brand: string | null; pack_quantity: string; pack_unit: string; last_price: string | null; supplier: { name: string } | null }[]).map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span><strong className="font-medium">{p.supplier?.name}</strong> · {p.description}{p.brand ? ` · ${p.brand}` : ""} ({numero(p.pack_quantity)} {p.pack_unit})</span>
                      <span className="tabular-nums text-grafito">{p.last_price ? euro(p.last_price) : "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Tarjeta>
          )}
        </div>
      </div>

      {verRecetas && (
        <section className="mt-10">
          <h2 className="mb-3 text-[22px] font-semibold tracking-[-0.02em]">Recetas que la usan</h2>
          {usosL.length === 0 ? <p className="text-[14px] text-niebla">Ninguna receta activa.</p> : (
            <ul className="grid gap-2 md:grid-cols-2">
              {usosL.map((u, k) => (
                <li key={k}>
                  <Link href={`/panel/${rid}/recetas/${u.recipe_versions.recipes.id}`} className="flex items-center justify-between rounded-2xl bg-white px-5 py-3 ring-1 ring-linea hover:bg-crema-2">
                    <span className="font-medium">{u.recipe_versions.recipes.name} <span className="text-[12px] font-normal text-niebla">· {u.recipe_versions.recipes.kind === "dish" ? "plato" : "elaboración"}</span></span>
                    <span className="text-[13px] tabular-nums text-grafito">{numero(u.quantity)} {u.unit === "unit" ? "ud" : u.unit}{u.quantity_type === "net" ? " netos" : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {verCompras && ((lineas.data ?? []) as unknown[]).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-[22px] font-semibold tracking-[-0.02em]">Últimas compras</h2>
          <Tabla cabeceras={["Fecha", "Proveedor", "Factura", "Cantidad", "Precio aplicado"]}>
            {((lineas.data ?? []) as unknown as { packs: string; pack_quantity: string; pack_unit: string; price_per_base_unit: string | null; invoice: { id: string; number: string; invoice_date: string; supplier: { name: string } | null } }[])
              .sort((a, b) => b.invoice.invoice_date.localeCompare(a.invoice.invoice_date)).map((l, k) => (
                <tr key={k}>
                  <td className="px-5 py-2.5 text-grafito">{new Date(l.invoice.invoice_date).toLocaleDateString("es-ES")}</td>
                  <td className="px-5 py-2.5">{l.invoice.supplier?.name ?? "—"}</td>
                  <td className="px-5 py-2.5"><Link href={`/panel/${rid}/compras/${l.invoice.id}`} className="text-musgo hover:underline">{l.invoice.number}</Link></td>
                  <td className="px-5 py-2.5 tabular-nums">{numero(l.packs)} × {numero(l.pack_quantity)} {l.pack_unit}</td>
                  <td className="px-5 py-2.5 tabular-nums">{l.price_per_base_unit ? `${euro(Number(l.price_per_base_unit) * ref, 3)} / ${unidadRef}` : "—"}</td>
                </tr>
              ))}
          </Tabla>
        </section>
      )}

      {verInv && ((movs.data ?? []) as unknown[]).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-[22px] font-semibold tracking-[-0.02em]">Movimientos de inventario</h2>
          <Tabla cabeceras={["Fecha", "Tipo", "Cantidad", "Detalle"]}>
            {((movs.data ?? []) as { id: string; kind: string; quantity: string; occurred_at: string; notes: string | null; reference: string | null }[]).map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-2.5 text-grafito">{new Date(m.occurred_at).toLocaleDateString("es-ES")}</td>
                <td className="px-5 py-2.5">{m.kind === "waste" ? <Insignia tono="pendiente">Merma</Insignia> : KIND[m.kind]}</td>
                <td className="px-5 py-2.5 tabular-nums">{fmtQ(Number(m.quantity))}</td>
                <td className="px-5 py-2.5 text-[13px] text-niebla">{m.reference ?? m.notes ?? ""}</td>
              </tr>
            ))}
          </Tabla>
        </section>
      )}

      {puede && (i.restaurant_id !== null || ctx.esPropietario(restaurante.organization_id)) && (
        <Tarjeta className="mt-10">
          <h2 className="text-[17px] font-semibold">Datos de la materia prima</h2>
          <FormularioAccion action={editarIngrediente} boton="Guardar cambios" limpiar={false} className="mt-5">
            <input type="hidden" name="restaurant_id" value={rid} /><input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={i.version} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Nombre" name="name" defaultValue={i.name} required className="sm:col-span-2" />
              <Campo label="Categoría" name="category" defaultValue={i.category ?? ""} />
              <Campo label="Rendimiento aprovechable" name="yield_pct" defaultValue={String(Number(i.yield_ratio) * 100)} inputMode="decimal" unidad="%" required />
              <Campo label="Densidad" name="density" defaultValue={i.density_g_per_ml ?? ""} inputMode="decimal" unidad="g/ml" />
              <Campo label="Peso por unidad" name="unit_weight_g" defaultValue={i.unit_weight_g ?? ""} inputMode="decimal" unidad="g" />
              <Campo label="Volumen por unidad" name="unit_volume_ml" defaultValue={i.unit_volume_ml ?? ""} inputMode="decimal" unidad="ml" />
              <Campo label="Conservación" name="storage" defaultValue={i.storage ?? ""} placeholder="Seco, refrigerado…" />
              <Campo label="Fuente del dato" name="source" defaultValue={i.source ?? ""} className="sm:col-span-2" />
            </div>
            <CasillasAlergenos marcados={(i.allergens ?? []) as string[]} className="mt-5" />
          </FormularioAccion>
        </Tarjeta>
      )}
    </>
  );
}
