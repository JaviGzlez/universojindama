import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Selector, Tabla, Tarjeta, Vacio, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarAjustes, cargarImpuestos, cargarTarifas } from "@/lib/datos";
import { archivar, crearImpuesto, crearTarifa, guardarAjustes } from "../actions";

export const metadata = { title: "Energía, impuestos y objetivos" };

const FUENTE = { electricity: "Electricidad", gas: "Gas", water: "Agua" } as const;
const hoy = () => new Date().toISOString().slice(0, 10);

export default async function Ajustes({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const [tarifas, impuestos, ajustes] = await Promise.all([
    cargarTarifas(ctx.supabase, rid), cargarImpuestos(ctx.supabase, rid), cargarAjustes(ctx.supabase, rid),
  ]);
  const puedeTarifas = ctx.puede(restaurante, "tarifas");
  const puedeImpuestos = ctx.puede(restaurante, "impuestos");
  const puedeAjustes = ctx.puede(restaurante, "ajustes");

  return (
    <>
      <Cabecera titulo="Energía, impuestos y objetivos" subtitulo="Tarifas e impuestos con fecha de vigencia. Un cambio crea un registro nuevo y conserva el anterior." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Tarjeta>
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Datos generales</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
            <dt className="text-niebla">Moneda</dt><dd>{restaurante.currency}</dd>
            <dt className="text-niebla">Zona horaria</dt><dd>{restaurante.timezone}</dd>
          </dl>
          {ajustes && (
            puedeAjustes ? (
              <FormularioAccion action={guardarAjustes} boton="Guardar ajustes" limpiar={false} className="mt-6">
                <input type="hidden" name="restaurant_id" value={rid} />
                <input type="hidden" name="version" value={ajustes.version} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Selector label="Política de precios" name="price_policy" defaultValue={ajustes.price_policy}
                    ayuda="Qué precio usa el escandallo cuando hay varias compras.">
                    <option value="last_validated">Último precio validado</option>
                    <option value="weighted_average">Media ponderada</option>
                  </Selector>
                  <Campo label="Decimales al presentar" name="money_decimals" type="number" min={0} max={6} defaultValue={ajustes.money_decimals} />
                  <Campo label="Raciones previstas al mes" name="planned_portions_month" inputMode="decimal" unidad="rac."
                    defaultValue={ajustes.targets?.planned_portions_month ?? ""} ayuda="Base para repartir los gastos generales por ración." />
                  <Campo label="Avisar si el coste de un plato cambia más de" name="cost_change_pct" inputMode="decimal" unidad="%"
                    defaultValue={ajustes.alert_thresholds?.cost_change_pct ?? 5} />
                  <Campo label="Objetivo de coste de materia prima" name="target_food_cost_pct" inputMode="decimal" unidad="%"
                    defaultValue={ajustes.targets?.target_food_cost_pct ?? ""} ayuda="Sobre el precio de venta neto. Se marca en la carta." />
                </div>
              </FormularioAccion>
            ) : (
              <p className="mt-4 text-[14px] text-niebla">Política de precios: {ajustes.price_policy === "last_validated" ? "último precio validado" : "media ponderada"}.</p>
            )
          )}
          {ajustes?.price_policy === "weighted_average" && (
            <p className="mt-4 rounded-xl bg-ambar-claro px-4 py-3 text-[13px] text-ambar">
              La media ponderada necesita compras con cantidades (fase 3). Hasta entonces el escandallo usa el último precio registrado.
            </p>
          )}
        </Tarjeta>

        {puedeTarifas && (
          <Tarjeta>
            <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Nueva tarifa de energía</h2>
            <FormularioAccion action={crearTarifa} boton="Guardar tarifa" className="mt-6">
              <input type="hidden" name="restaurant_id" value={rid} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Nombre" name="name" required placeholder="Luz 3.0TD" />
                <Selector label="Fuente" name="source" defaultValue="electricity">
                  <option value="electricity">Electricidad</option>
                  <option value="gas">Gas</option>
                  <option value="water">Agua</option>
                </Selector>
                <Campo label="Precio" name="price_per_unit" inputMode="decimal" unidad="€" required />
                <Selector label="Por unidad" name="unit" defaultValue="kWh">
                  <option value="kWh">kWh</option>
                  <option value="m3">m³</option>
                  <option value="l">litro</option>
                </Selector>
                <Campo label="Vigente desde" name="valid_from" type="date" defaultValue={hoy()} required />
                <label className="flex items-center gap-2 self-end pb-3 text-[14px] text-grafito">
                  <input type="checkbox" name="includes_taxes" className="h-4 w-4 accent-musgo" /> Incluye impuestos
                </label>
              </div>
            </FormularioAccion>
          </Tarjeta>
        )}
      </div>

      <h2 className="mb-4 mt-12 text-[24px] font-semibold tracking-[-0.02em]">Tarifas</h2>
      {tarifas.length === 0 ? (
        <Vacio titulo="Sin tarifas" texto="Sin tarifa, la energía de los platos queda pendiente (nunca a cero)." />
      ) : (
        <Tabla cabeceras={["Tarifa", "Fuente", "Precio", "Vigencia", ""]}>
          {tarifas.map((t) => (
            <tr key={t.id}>
              <td className="px-5 py-4 font-medium">{t.name}</td>
              <td className="px-5 py-4 text-grafito">{FUENTE[t.source]}</td>
              <td className="px-5 py-4 tabular-nums">{euro(t.price_per_unit, 4)} / {t.unit} {t.includes_taxes && <span className="text-[12px] text-niebla">(con impuestos)</span>}</td>
              <td className="px-5 py-4 text-grafito">desde {new Date(t.valid_from).toLocaleDateString("es-ES")}{t.valid_to ? ` hasta ${new Date(t.valid_to).toLocaleDateString("es-ES")}` : ""}</td>
              <td className="px-5 py-4 text-right">
                {puedeTarifas && <AccionRapida action={archivar} etiqueta="Archivar" campos={{ restaurant_id: rid, tabla: "energy_tariffs", id: t.id, version: t.version, ruta: "/ajustes" }} />}
              </td>
            </tr>
          ))}
        </Tabla>
      )}

      <h2 className="mb-4 mt-12 text-[24px] font-semibold tracking-[-0.02em]">Impuestos</h2>
      {puedeImpuestos && (
        <Tarjeta className="mb-6">
          <FormularioAccion action={crearImpuesto} boton="Guardar impuesto">
            <input type="hidden" name="restaurant_id" value={rid} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Campo label="Nombre" name="name" required placeholder="IVA hostelería" />
              <Selector label="Aplica a" name="kind" defaultValue="sale">
                <option value="sale">Venta</option>
                <option value="purchase">Compra</option>
              </Selector>
              <Campo label="Tipo" name="rate_pct" inputMode="decimal" unidad="%" required />
              <Campo label="Vigente desde" name="valid_from" type="date" defaultValue={hoy()} required />
              <label className="flex items-center gap-2 self-end pb-3 text-[14px] text-grafito">
                <input type="checkbox" name="recoverable" defaultChecked className="h-4 w-4 accent-musgo" /> Recuperable
              </label>
            </div>
          </FormularioAccion>
        </Tarjeta>
      )}
      {impuestos.length === 0 ? (
        <Vacio titulo="Sin impuestos" texto="Configura el impuesto de venta para obtener el precio neto y los márgenes." />
      ) : (
        <Tabla cabeceras={["Impuesto", "Aplica a", "Tipo", "Recuperable", "Vigente desde", ""]}>
          {impuestos.map((t) => (
            <tr key={t.id}>
              <td className="px-5 py-4 font-medium">{t.name}</td>
              <td className="px-5 py-4 text-grafito">{t.kind === "sale" ? "Venta" : "Compra"}</td>
              <td className="px-5 py-4 tabular-nums">{numero(Number(t.rate) * 100, 2)} %</td>
              <td className="px-5 py-4 text-grafito">{t.recoverable ? "Sí" : "No"}</td>
              <td className="px-5 py-4 text-grafito">{new Date(t.valid_from).toLocaleDateString("es-ES")}</td>
              <td className="px-5 py-4 text-right">
                {puedeImpuestos && <AccionRapida action={archivar} etiqueta="Archivar" campos={{ restaurant_id: rid, tabla: "tax_rates", id: t.id, version: t.version, ruta: "/ajustes" }} />}
              </td>
            </tr>
          ))}
        </Tabla>
      )}
    </>
  );
}
