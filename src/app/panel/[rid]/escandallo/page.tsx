import { notFound } from "next/navigation";
import { Cabecera } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarAjustes, cargarConsumibles, cargarEquipos, cargarImpuestos, cargarIngredientes, cargarPerfiles, cargarTarifas, tarifasVigentes } from "@/lib/datos";
import { Calculadora, type DatosCalculadora } from "./calculadora";

export const metadata = { title: "Escandallo" };

export default async function Escandallo({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const [ings, equipos, perfiles, tarifas, impuestos, consumibles, ajustes] = await Promise.all([
    cargarIngredientes(sb, rid, restaurante.organization_id), cargarEquipos(sb, rid), cargarPerfiles(sb, rid),
    cargarTarifas(sb, rid), cargarImpuestos(sb, rid), cargarConsumibles(sb, rid), cargarAjustes(sb, rid),
  ]);
  const vigentes = new Map(tarifasVigentes(tarifas).map((t) => [t.id, t]));

  const datos: DatosCalculadora = {
    moneda: restaurante.currency,
    decimales: ajustes?.money_decimals ?? 2,
    ingredientes: ings.map((i) => ({
      id: i.id, name: i.name, baseUnit: i.base_unit, yieldRatio: i.yield_ratio,
      densityGPerMl: i.density_g_per_ml, unitWeightG: i.unit_weight_g, unitVolumeMl: i.unit_volume_ml,
      pricePerBaseUnit: i.precio?.price_per_base_unit ?? null, priceQuality: i.precio?.quality ?? "measured",
    })),
    equipos: equipos.map((e) => {
      const t = e.energy_tariff_id ? vigentes.get(e.energy_tariff_id) : undefined;
      return {
        id: e.id, name: e.name, source: e.energy_source, nominalPowerW: e.nominal_power_w, powerQuality: e.power_quality,
        dutyFactor: e.duty_factor, dutyFactorQuality: e.duty_factor_quality, preheatMinutes: e.preheat_minutes,
        tariffPricePerUnit: t?.price_per_unit ?? null, tariffUnit: t?.unit ?? (e.energy_source === "water" ? "m3" : "kWh"),
        tariffName: t?.name ?? null,
      };
    }),
    perfiles: perfiles.map((p) => ({ id: p.id, name: p.name, costPerHour: p.cost_per_hour })),
    consumibles: consumibles
      .filter((c) => c.imputation_unit === "portion" || c.imputation_unit === "batch")
      .map((c) => ({ id: c.id, name: c.name, amount: c.amount, per: c.imputation_unit as "portion" | "batch" })),
    impuestosVenta: impuestos.filter((t) => t.kind === "sale").map((t) => ({ id: t.id, name: t.name, rate: t.rate })),
  };

  return (
    <>
      <Cabecera
        titulo="Escandallo"
        subtitulo="Simula el coste de un plato con los ajustes de este restaurante. Esta simulación no se guarda ni modifica ningún catálogo; guardar recetas con versión llega en la fase 2."
      />
      <Calculadora datos={datos} />
    </>
  );
}
