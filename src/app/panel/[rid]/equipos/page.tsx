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

  return (
    <>
      <Cabecera titulo="Equipos y consumibles" subtitulo="Se configuran una vez y se seleccionan después en cada plato. Indica si cada dato es medido, del fabricante o estimado." />

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
        <Tabla cabeceras={["Equipo", "Fuente", "Potencia", "Factor", "Precalentamiento", "Tarifa", ""]}>
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
        <Tabla cabeceras={["Concepto", "Importe", "Imputación", "Regla", ""]}>
          {consumibles.map((c) => (
            <tr key={c.id}>
              <td className="px-5 py-4 font-medium">{c.name}</td>
              <td className="px-5 py-4 tabular-nums">{euro(c.amount, 4)}</td>
              <td className="px-5 py-4 text-grafito">{IMPUTACION[c.imputation_unit]}</td>
              <td className="px-5 py-4 text-[13px] text-grafito">{c.rule ?? "—"}</td>
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
