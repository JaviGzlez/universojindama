import Link from "next/link";
import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Selector, Tabla, Tarjeta, Vacio, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarConsumibles, cargarEquipos, cargarTarifas } from "@/lib/datos";
import { archivar, crearConsumible, crearEquipo } from "../actions";

export const metadata = { title: "Equipos" };

const FUENTE = { electricity: "Electricidad", gas: "Gas", water: "Agua" } as const;
const CALIDAD = { measured: "medido", manufacturer: "fabricante", estimated: "estimado" } as const;
const IMPUTACION = { portion: "por ración", batch: "por tanda", minute: "por minuto", order: "por pedido", percent: "% sobre venta" } as const;

export default async function Equipos({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const [equipos, tarifas, consumibles] = await Promise.all([
    cargarEquipos(ctx.supabase, rid), cargarTarifas(ctx.supabase, rid), cargarConsumibles(ctx.supabase, rid),
  ]);
  const puede = ctx.puede(restaurante, "equipos");
  const nombreTarifa = new Map(tarifas.map((t) => [t.id, t]));
  // Uso en recetas activas: equipos y consumibles enlazados con el escandallo
  const [{ data: usoEq }, { data: usoCons }] = await Promise.all([
    ctx.supabase.from("recipe_equipment_usage").select("equipment_id, minutes, recipe_versions!inner(status, recipes!inner(id, name))").eq("restaurant_id", rid).eq("recipe_versions.status", "active"),
    ctx.supabase.from("recipe_consumables").select("consumable_id, recipe_versions!inner(status, recipes!inner(id, name))").eq("restaurant_id", rid).eq("recipe_versions.status", "active"),
  ]);
  type Uso = { recipe_versions: { recipes: { id: string; name: string } } };
  const agrupar = (filas: (Uso & Record<string, unknown>)[], clave: string) => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const f of filas) {
      const k = String(f[clave]);
      const l = m.get(k) ?? [];
      if (!l.some((x) => x.id === f.recipe_versions.recipes.id)) l.push(f.recipe_versions.recipes);
      m.set(k, l);
    }
    return m;
  };
  const recetasEq = agrupar((usoEq ?? []) as unknown as (Uso & Record<string, unknown>)[], "equipment_id");
  const recetasCons = agrupar((usoCons ?? []) as unknown as (Uso & Record<string, unknown>)[], "consumable_id");
  /** Coste orientativo por hora de funcionamiento: potencia × factor × precio del kWh (o consumo medido × precio). */
  const costeHora = (e: (typeof equipos)[number]) => {
    const t = e.energy_tariff_id ? nombreTarifa.get(e.energy_tariff_id) : undefined;
    if (!t) return null;
    const precio = Number(t.price_per_unit);
    if (e.measured_consumption_per_hour) return Number(e.measured_consumption_per_hour) * precio;
    if (!e.nominal_power_w || t.unit !== "kWh") return null;
    return (Number(e.nominal_power_w) / 1000) * Number(e.duty_factor) * precio;
  };
  const UsadoEn = ({ l }: { l?: { id: string; name: string }[] }) =>
    !l?.length ? <span className="text-niebla">—</span> : (
      <span title={l.map((x) => x.name).join(", ")} className="text-grafito">
        {l.slice(0, 2).map((x, k) => (
          <span key={x.id}>{k > 0 && ", "}<Link href={`/panel/${rid}/recetas/${x.id}`} className="hover:text-musgo hover:underline">{x.name}</Link></span>
        ))}
        {l.length > 2 && <span className="text-niebla"> y {l.length - 2} más</span>}
      </span>
    );

  return (
    <>
      <Cabecera titulo="Equipos y consumibles" subtitulo="Se configuran una vez y se seleccionan después en cada receta (pestaña Composición y coste y en los pasos del proceso). Al cambiar una tarifa o un equipo, el coste de energía de los platos que lo usan se recalcula." />

      {puede && (
        <Tarjeta className="mb-8">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Nuevo equipo</h2>
          <FormularioAccion action={crearEquipo} boton="Guardar equipo" className="mt-6">
            <input type="hidden" name="restaurant_id" value={rid} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Nombre" name="name" required placeholder="Horno mixto" className="sm:col-span-2" />
              <Selector label="Fuente energética" name="energy_source" defaultValue="electricity">
                <option value="electricity">Electricidad</option>
                <option value="gas">Gas</option>
                <option value="water">Agua</option>
              </Selector>
              <Selector label="Tarifa" name="energy_tariff_id" defaultValue="" ayuda={tarifas.length ? undefined : "Crea antes una tarifa en Energía e impuestos."}>
                <option value="">Sin asignar</option>
                {tarifas.map((t) => <option key={t.id} value={t.id}>{t.name} · {FUENTE[t.source]}</option>)}
              </Selector>
              <Campo label="Potencia nominal" name="nominal_power_w" inputMode="decimal" unidad="W" />
              <Selector label="Origen de la potencia" name="power_quality" defaultValue="manufacturer">
                <option value="manufacturer">Fabricante</option>
                <option value="measured">Medida</option>
                <option value="estimated">Estimada</option>
              </Selector>
              <Campo label="Factor de funcionamiento" name="duty_pct" defaultValue="100" inputMode="decimal" unidad="%" ayuda="Parte del tiempo que consume a potencia nominal." />
              <Selector label="Origen del factor" name="duty_factor_quality" defaultValue="estimated">
                <option value="estimated">Estimado</option>
                <option value="measured">Medido</option>
                <option value="manufacturer">Fabricante</option>
              </Selector>
              <Campo label="Precalentamiento" name="preheat_minutes" defaultValue="0" inputMode="decimal" unidad="min" />
              <Campo label="Capacidad por tanda" name="batch_capacity" inputMode="decimal" unidad="rac." />
              <Campo label="Notas" name="notes" className="sm:col-span-2" />
            </div>
          </FormularioAccion>
        </Tarjeta>
      )}

      {equipos.length === 0 ? (
        <Vacio titulo="Aún no hay equipos" texto="Añade hornos, fogones, freidoras… con su potencia y tarifa para calcular la energía de cada plato." />
      ) : (
        <Tabla cabeceras={["Equipo", "Fuente", "Potencia", "Factor", "Precalentamiento", "Tarifa", "Coste/hora", "Usado en", ""]}>
          {equipos.map((e) => {
            const t = e.energy_tariff_id ? nombreTarifa.get(e.energy_tariff_id) : undefined;
            return (
              <tr key={e.id}>
                <td className="px-5 py-4 font-medium">{e.name}</td>
                <td className="px-5 py-4 text-grafito">{FUENTE[e.energy_source]}</td>
                <td className="px-5 py-4 text-grafito">
                  {e.nominal_power_w ? `${numero(e.nominal_power_w, 0)} W` : "—"}{" "}
                  <span className="text-[12px] text-niebla">({CALIDAD[e.power_quality]})</span>
                </td>
                <td className="px-5 py-4 text-grafito">
                  {numero(Number(e.duty_factor) * 100, 1)} % <span className="text-[12px] text-niebla">({CALIDAD[e.duty_factor_quality]})</span>
                </td>
                <td className="px-5 py-4 text-grafito">{numero(e.preheat_minutes, 0)} min</td>
                <td className="px-5 py-4">{t ? <span className="text-grafito">{t.name}</span> : <Insignia tono="pendiente">Sin tarifa</Insignia>}</td>
                <td className="px-5 py-4 tabular-nums text-grafito">{(() => { const c = costeHora(e); return c === null ? "—" : euro(c, 3); })()}</td>
                <td className="px-5 py-4 text-[13px]"><UsadoEn l={recetasEq.get(e.id)} /></td>
                <td className="px-5 py-4 text-right">
                  {puede && (
                    <AccionRapida action={archivar} etiqueta="Archivar" confirmar={`¿Archivar «${e.name}»?`}
                      campos={{ restaurant_id: rid, tabla: "equipment", id: e.id, version: e.version, ruta: "/equipos" }} />
                  )}
                </td>
              </tr>
            );
          })}
        </Tabla>
      )}

      <h2 className="mb-4 mt-14 text-[24px] font-semibold tracking-[-0.02em]">Envases y consumibles</h2>
      {ctx.puede(restaurante, "equipos") && (
        <Tarjeta className="mb-6">
          <FormularioAccion action={crearConsumible} boton="Guardar consumible">
            <input type="hidden" name="restaurant_id" value={rid} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Nombre" name="name" required placeholder="Caja kraft hamburguesa" />
              <Selector label="Se imputa" name="imputation_unit" defaultValue="portion">
                <option value="portion">Por ración</option>
                <option value="batch">Por tanda</option>
                <option value="order">Por pedido</option>
              </Selector>
              <Campo label="Importe" name="amount" inputMode="decimal" unidad="€" required />
              <Campo label="Regla de aplicación" name="rule" placeholder="Solo en reparto y recogida" />
            </div>
          </FormularioAccion>
        </Tarjeta>
      )}
      {consumibles.length === 0 ? (
        <Vacio titulo="Sin consumibles" texto="Envases, servilletas o limpieza por proceso, con su base de imputación." />
      ) : (
        <Tabla cabeceras={["Concepto", "Importe", "Imputación", "Regla", "Usado en", ""]}>
          {consumibles.map((c) => (
            <tr key={c.id}>
              <td className="px-5 py-4 font-medium">{c.name}</td>
              <td className="px-5 py-4 tabular-nums">{euro(c.amount, 4)}</td>
              <td className="px-5 py-4 text-grafito">{IMPUTACION[c.imputation_unit]}</td>
              <td className="px-5 py-4 text-[13px] text-grafito">{c.rule ?? "—"}</td>
              <td className="px-5 py-4 text-[13px]"><UsadoEn l={recetasCons.get(c.id)} /></td>
              <td className="px-5 py-4 text-right">
                {puede && (
                  <AccionRapida action={archivar} etiqueta="Archivar"
                    campos={{ restaurant_id: rid, tabla: "consumables", id: c.id, version: c.version, ruta: "/equipos" }} />
                )}
              </td>
            </tr>
          ))}
        </Tabla>
      )}
    </>
  );
}
