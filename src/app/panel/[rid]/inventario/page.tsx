import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Selector, Tabla, Tarjeta, Vacio, claseInput, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarIngredientes } from "@/lib/datos";
import type { IngredientRef } from "@/lib/engine";
import { consumoPorRacion, type FilaDesviacion, type VersionConsumo } from "@/lib/inventario";
import { cargarRecetas, cargarVersion } from "@/lib/recetas";
import { guardarRecuento, registrarMovimiento } from "./actions";

export const metadata = { title: "Inventario" };

const UNIDAD = { g: "g", ml: "ml", unit: "ud" } as const;
const fmtQ = (v: number, u: "g" | "ml" | "unit") =>
  u === "unit" ? `${numero(v, 1)} ud` : Math.abs(v) >= 1000 ? `${numero(v / 1000, 2)} ${u === "g" ? "kg" : "l"}` : `${numero(v, 0)} ${u}`;

export default async function Inventario({ params, searchParams }: { params: Promise<{ rid: string }>; searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const { rid } = await params;
  const sp = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const [ings, { data: stock }, { data: recuentos }, { data: ultimos }] = await Promise.all([
    cargarIngredientes(sb, rid, restaurante.organization_id),
    sb.rpc("stock_on_hand", { p_restaurant: rid }),
    sb.from("stock_counts").select("id, counted_at, notes").eq("restaurant_id", rid).order("counted_at", { ascending: false }).limit(24),
    sb.from("stock_movements").select("id, ingredient_id, kind, quantity, occurred_at, reference, notes").eq("restaurant_id", rid).order("occurred_at", { ascending: false }).limit(15),
  ]);
  const ing = new Map(ings.map((i) => [i.id, i]));
  const puede = ctx.puede(restaurante, "precios");
  const filasStock = ((stock ?? []) as { ingredient_id: string; quantity: string; last_count_at: string | null }[])
    .map((s) => ({ ...s, i: ing.get(s.ingredient_id) }))
    .filter((s) => s.i)
    .sort((a, b) => a.i!.name.localeCompare(b.i!.name));
  const valorTotal = filasStock.reduce((a, s) => a + (s.i!.precio ? Number(s.quantity) * Number(s.i!.precio.price_per_base_unit) : 0), 0);

  // ----------------------------------------------------------- desviación
  const lista = recuentos ?? [];
  const fin = lista.find((c) => c.id === sp.hasta) ?? lista[0];
  const ini = lista.find((c) => c.id === sp.desde) ?? lista.find((c) => fin && c.counted_at < fin.counted_at);
  let desviacion: FilaDesviacion[] = [];
  const avisos = new Set<string>();
  if (ini && fin && ini.counted_at < fin.counted_at) {
    const [{ data: lIni }, { data: lFin }, { data: movs }, { data: ventas }, { data: carta }, recetas] = await Promise.all([
      sb.from("stock_count_lines").select("ingredient_id, quantity").eq("count_id", ini.id),
      sb.from("stock_count_lines").select("ingredient_id, quantity").eq("count_id", fin.id),
      sb.from("stock_movements").select("ingredient_id, kind, quantity").eq("restaurant_id", rid).gt("occurred_at", ini.counted_at).lte("occurred_at", fin.counted_at).limit(10000),
      sb.from("sales").select("menu_item_id, quantity").eq("restaurant_id", rid).gt("sale_date", ini.counted_at.slice(0, 10)).lte("sale_date", fin.counted_at.slice(0, 10)).limit(20000),
      sb.from("menu_items").select("id, recipe_id").eq("restaurant_id", rid),
      cargarRecetas(sb, rid),
    ]);
    const refs: Record<string, IngredientRef> = Object.fromEntries(ings.map((i) => [i.id, {
      id: i.id, name: i.name, baseUnit: i.base_unit, yieldRatio: i.yield_ratio, densityGPerMl: i.density_g_per_ml,
      unitWeightG: i.unit_weight_g, unitVolumeMl: i.unit_volume_ml, pricePerBaseUnit: null,
    }]));
    const versiones: Record<string, VersionConsumo | undefined> = {};
    await Promise.all(recetas.filter((x) => x.active_version_id).map(async (x) => {
      const v = await cargarVersion(sb, x.active_version_id!);
      if (v) versiones[x.id] = { kind: x.kind, portions: v.portions, yield_quantity: v.yield_quantity, yield_unit: v.yield_unit, ingredientes: v.ingredientes };
    }));
    const recetaDe = new Map((carta ?? []).map((m) => [m.id, m.recipe_id as string | null]));
    const teorico = new Map<string, number>();
    const cache = new Map<string, Map<string, { toNumber(): number }>>();
    let sinReceta = 0;
    for (const v of ventas ?? []) {
      const rec = recetaDe.get(v.menu_item_id);
      const ver = rec ? versiones[rec] : undefined;
      if (!ver) { sinReceta += Number(v.quantity); continue; }
      if (!cache.has(rec!)) cache.set(rec!, consumoPorRacion(ver, refs, versiones, avisos));
      for (const [id, q] of cache.get(rec!)!) teorico.set(id, (teorico.get(id) ?? 0) + q.toNumber() * Number(v.quantity));
    }
    if (sinReceta) avisos.add(`${numero(sinReceta)} unidades vendidas de platos sin receta activa no cuentan en el consumo teórico.`);
    const iniQ = new Map((lIni ?? []).map((l) => [l.ingredient_id, Number(l.quantity)]));
    const finQ = new Map((lFin ?? []).map((l) => [l.ingredient_id, Number(l.quantity)]));
    const sinInicial = [...finQ.keys()].filter((id) => !iniQ.has(id)).length;
    if (sinInicial) avisos.add(`${sinInicial} materias primas del recuento final no estaban en el inicial y no se comparan.`);
    desviacion = [...finQ.keys()].filter((id) => iniQ.has(id) && ing.has(id)).map((id) => {
      const m = (movs ?? []).filter((x) => x.ingredient_id === id);
      const entradas = m.filter((x) => Number(x.quantity) > 0).reduce((a, x) => a + Number(x.quantity), 0);
      const salidasNoConsumo = m.filter((x) => Number(x.quantity) < 0).reduce((a, x) => a + Number(x.quantity), 0);
      const mermas = m.filter((x) => x.kind === "waste").reduce((a, x) => a + Number(x.quantity), 0);
      const real = iniQ.get(id)! + entradas + salidasNoConsumo - finQ.get(id)!;
      const t = teorico.get(id) ?? 0;
      const precio = ing.get(id)!.precio?.price_per_base_unit;
      return {
        ingredient_id: id, inicial: iniQ.get(id)!, entradas, mermas: -mermas, final: finQ.get(id)!, real, teorico: t,
        desviacion: real - t, valor: precio ? (real - t) * Number(precio) : null,
      };
    }).sort((a, b) => Math.abs(b.valor ?? 0) - Math.abs(a.valor ?? 0));
  }
  const fecha = (s: string) => new Date(s).toLocaleString("es-ES", { timeZone: restaurante.timezone, dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <Cabecera
        titulo="Inventario y mermas"
        subtitulo="Existencias = último recuento + movimientos posteriores. Las compras entran al registrar facturas. Compras no equivalen a consumo: el consumo real se mide entre dos recuentos."
      />

      {puede && ings.length > 0 && (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <Tarjeta>
            <h2 className="text-[17px] font-semibold">Registrar movimiento</h2>
            <FormularioAccion action={registrarMovimiento} boton="Registrar" className="mt-4">
              <input type="hidden" name="rid" value={rid} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Selector label="Materia prima" name="ingredient_id" className="sm:col-span-2">{ings.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Selector>
                <Selector label="Tipo" name="kind" defaultValue="waste">
                  <option value="waste">Merma / desperdicio</option>
                  <option value="adjustment_minus">Ajuste (−)</option>
                  <option value="adjustment_plus">Ajuste (+)</option>
                  <option value="transfer_out">Traspaso a otro local</option>
                  <option value="transfer_in">Traspaso desde otro local</option>
                  <option value="production_out">Consumo para producción</option>
                  <option value="production_in">Entrada de producción</option>
                </Selector>
                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <Campo label="Cantidad" name="quantity" inputMode="decimal" required />
                  <Selector label="Unidad" name="unit" defaultValue="kg"><option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="unit">ud</option></Selector>
                </div>
                <Campo label="Fecha y hora" name="occurred_at" type="datetime-local" />
                <Campo label="Motivo" name="notes" placeholder="Caducado, rotura…" />
              </div>
            </FormularioAccion>
          </Tarjeta>
          <Tarjeta>
            <details>
              <summary className="cursor-pointer list-none text-[17px] font-semibold">Hacer un recuento <span className="text-[13px] font-normal text-musgo">· abrir</span></summary>
              <FormularioAccion action={guardarRecuento} boton="Guardar recuento" className="mt-4">
                <input type="hidden" name="rid" value={rid} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo label="Fecha y hora del recuento" name="counted_at" type="datetime-local" />
                  <Campo label="Notas" name="notes" />
                </div>
                <p className="mt-4 text-[12px] text-niebla">Cantidad contada en la unidad base. Deja en blanco lo que no cuentes.</p>
                <ul className="mt-2 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {ings.map((i) => (
                    <li key={i.id} className="grid grid-cols-[1fr_140px] items-center gap-3">
                      <span className="truncate text-[14px]">{i.name}</span>
                      <span className="relative">
                        <input name={`q_${i.id}`} inputMode="decimal" aria-label={`${i.name} (${UNIDAD[i.base_unit]})`} className={`${claseInput} h-9 pr-10`} />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-niebla">{UNIDAD[i.base_unit]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </FormularioAccion>
            </details>
          </Tarjeta>
        </div>
      )}

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Existencias</h2>
        <p className="text-[14px] text-grafito">Valor estimado <span className="font-semibold tabular-nums">{euro(valorTotal)}</span></p>
      </div>
      {filasStock.length === 0 ? (
        <Vacio titulo="Sin existencias" texto="Haz un primer recuento o registra facturas para empezar." />
      ) : (
        <Tabla cabeceras={["Materia prima", "Existencias", "Valor", "Último recuento"]}>
          {filasStock.map((s) => (
            <tr key={s.ingredient_id}>
              <td className="px-5 py-3 font-medium">{s.i!.name}</td>
              <td className={`px-5 py-3 tabular-nums ${Number(s.quantity) < 0 ? "text-terracota" : ""}`}>{fmtQ(Number(s.quantity), s.i!.base_unit)}</td>
              <td className="px-5 py-3 tabular-nums text-grafito">{s.i!.precio ? euro(Number(s.quantity) * Number(s.i!.precio.price_per_base_unit)) : "—"}</td>
              <td className="px-5 py-3 text-grafito">{s.last_count_at ? fecha(s.last_count_at) : <Insignia tono="pendiente">Sin recuento</Insignia>}</td>
            </tr>
          ))}
        </Tabla>
      )}

      <section className="mt-12">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Consumo real frente a teórico</h2>
        <p className="mt-1 text-[14px] text-niebla">Real = recuento inicial + entradas − salidas ajenas al consumo − recuento final. Teórico = ventas × recetas activas. Las diferencias hay que revisarlas antes de atribuir causas.</p>
        {lista.length < 2 ? (
          <p className="mt-4 rounded-[22px] border border-dashed border-linea px-6 py-8 text-center text-[14px] text-niebla">Necesitas al menos dos recuentos para comparar un periodo.</p>
        ) : (
          <>
            <form className="mt-4 flex flex-wrap items-end gap-3">
              <Selector label="Desde el recuento" name="desde" defaultValue={ini?.id}>{lista.map((c) => <option key={c.id} value={c.id}>{fecha(c.counted_at)}</option>)}</Selector>
              <Selector label="Hasta el recuento" name="hasta" defaultValue={fin?.id}>{lista.map((c) => <option key={c.id} value={c.id}>{fecha(c.counted_at)}</option>)}</Selector>
              <button className="h-11 rounded-full bg-tinta px-5 text-[14px] font-medium text-crema">Comparar</button>
            </form>
            {avisos.size > 0 && <ul className="mt-4 space-y-1 rounded-2xl bg-ambar-claro px-5 py-3 text-[13px] text-ambar">{[...avisos].map((a) => <li key={a}>▲ {a}</li>)}</ul>}
            {desviacion.length > 0 ? (
              <div className="mt-4">
                <Tabla cabeceras={["Materia prima", "Inicial", "Entradas", "Mermas", "Final", "Real", "Teórico", "Desviación", "Valor"]}>
                  {desviacion.map((d) => {
                    const u = ing.get(d.ingredient_id)!.base_unit;
                    return (
                      <tr key={d.ingredient_id}>
                        <td className="px-4 py-3 font-medium">{ing.get(d.ingredient_id)!.name}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtQ(d.inicial, u)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtQ(d.entradas, u)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtQ(d.mermas, u)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtQ(d.final, u)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtQ(d.real, u)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtQ(d.teorico, u)}</td>
                        <td className={`px-4 py-3 font-medium tabular-nums ${d.desviacion > 0 ? "text-terracota" : ""}`}>{d.desviacion > 0 ? "+" : ""}{fmtQ(d.desviacion, u)}</td>
                        <td className="px-4 py-3 tabular-nums">{d.valor === null ? "—" : euro(d.valor)}</td>
                      </tr>
                    );
                  })}
                </Tabla>
              </div>
            ) : ini && fin ? (
              <p className="mt-4 text-[14px] text-niebla">No hay materias primas contadas en ambos recuentos.</p>
            ) : null}
          </>
        )}
      </section>

      {(ultimos?.length ?? 0) > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-niebla">Últimos movimientos</h2>
          <Tabla cabeceras={["Fecha", "Materia prima", "Tipo", "Cantidad", "Detalle"]}>
            {ultimos!.map((m) => {
              const i = ing.get(m.ingredient_id);
              const tipo = { purchase: "Compra", waste: "Merma", adjustment: "Ajuste", transfer_in: "Traspaso (entrada)", transfer_out: "Traspaso (salida)", production_in: "Producción (entrada)", production_out: "Producción (consumo)" }[m.kind as string];
              return (
                <tr key={m.id}>
                  <td className="px-5 py-2.5 text-grafito">{fecha(m.occurred_at)}</td>
                  <td className="px-5 py-2.5">{i?.name ?? "—"}</td>
                  <td className="px-5 py-2.5 text-grafito">{tipo}</td>
                  <td className="px-5 py-2.5 tabular-nums">{i ? fmtQ(Number(m.quantity), i.base_unit) : m.quantity}</td>
                  <td className="px-5 py-2.5 text-[13px] text-niebla">{m.reference ?? m.notes ?? ""}</td>
                </tr>
              );
            })}
          </Tabla>
        </section>
      )}
    </>
  );
}
