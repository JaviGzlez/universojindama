import { D, dec, fmt, safeDiv, ser, sum, SERIALIZED_DECIMALS, type Dec } from "./decimal";
import { toBaseUnit } from "./units";
import type {
  CalculationInput,
  CalculationResult,
  CalculationStatus,
  CostLine,
  Coverage,
  DataQuality,
  MissingInput,
} from "./types";

export const ENGINE_VERSION = "1";

const QUALITY_RANK: Record<DataQuality, number> = { measured: 0, manufacturer: 1, estimated: 2 };
const worst = (...q: DataQuality[]): DataQuality =>
  q.reduce((a, b) => (QUALITY_RANK[b] > QUALITY_RANK[a] ? b : a), "measured" as DataQuality);

const UNIT_LABEL: Record<string, string> = { g: "g", ml: "ml", unit: "ud" };

/**
 * Motor determinista de escandallo. No accede a base de datos ni a IA:
 * recibe datos ya resueltos (precios vigentes, tarifas, perfiles) y devuelve
 * un desglose comprobable línea a línea.
 */
export function calculate(input: CalculationInput): CalculationResult {
  const missing: MissingInput[] = [];
  const assumptions: string[] = [];
  const lines: CostLine[] = [];
  const block = (m: Omit<MissingInput, "severity">) => missing.push({ ...m, severity: "blocking" });
  const warn = (m: Omit<MissingInput, "severity">) => missing.push({ ...m, severity: "warning" });

  // ---------------------------------------------------------------- raciones
  const portions = dec(input.portions);
  const portionsOk = portions !== null && portions.greaterThan(0);
  if (!portionsOk) {
    block({ code: "PORTIONS_INVALID", field: "portions", message: "Las raciones vendibles deben ser mayores que cero." });
  }
  const perPortion = (v: Dec | null) => (portionsOk && v !== null ? v.div(portions!) : null);

  // ---------------------------------------------------------- materia prima
  const ingredientAmounts: (Dec | null)[] = [];
  input.ingredients.forEach((line, i) => {
    const ing = line.ingredient;
    const field = `ingredients[${i}]`;
    const qty = dec(line.quantity);
    if (qty === null || qty.lessThan(0)) {
      block({ code: "INVALID_QUANTITY", field: `${field}.quantity`, message: `«${ing.name}»: cantidad no válida.` });
      ingredientAmounts.push(null);
      return;
    }
    const conv = toBaseUnit(qty, line.unit, ing);
    if (!conv.ok) {
      block({ code: conv.code, field, message: conv.message });
      ingredientAmounts.push(null);
      lines.push(ingredientLine(ing.name, ing.id, null, ing.baseUnit, null, "Conversión de unidades pendiente", ing.priceQuality));
      return;
    }
    const yieldRatio = dec(ing.yieldRatio);
    if (yieldRatio === null || yieldRatio.lessThanOrEqualTo(0) || yieldRatio.greaterThan(1)) {
      block({ code: "INVALID_YIELD", field: `${field}.yieldRatio`, message: `«${ing.name}»: el rendimiento debe estar entre 0 y 1 (80 % = 0,80).` });
      ingredientAmounts.push(null);
      return;
    }
    // Si la cantidad ya es bruta, no se aplica de nuevo la merma.
    const gross = line.quantityType === "net" ? conv.value.div(yieldRatio) : conv.value;
    const price = dec(ing.pricePerBaseUnit);
    const u = UNIT_LABEL[ing.baseUnit];
    const yieldText = line.quantityType === "net" && !yieldRatio.equals(1)
      ? `${fmt(conv.value, 4)} ${u} netos / ${fmt(yieldRatio)} rendimiento = ${fmt(gross, 4)} ${u} brutos`
      : `${fmt(gross, 4)} ${u} ${line.quantityType === "gross" ? "brutos (sin aplicar merma)" : ""}`.trim();
    const convText = conv.note ? ` (convertido con ${conv.note})` : "";

    if (price === null || price.lessThan(0)) {
      block({ code: "INGREDIENT_PRICE_MISSING", field: `${field}.pricePerBaseUnit`, message: `«${ing.name}»: falta el precio vigente.` });
      ingredientAmounts.push(null);
      lines.push(ingredientLine(ing.name, ing.id, gross, ing.baseUnit, null, `${yieldText}${convText} × precio pendiente`, ing.priceQuality));
      return;
    }
    const amount = gross.times(price);
    ingredientAmounts.push(amount);
    lines.push(ingredientLine(ing.name, ing.id, gross, ing.baseUnit, amount, `${yieldText}${convText} × ${fmt(price, 8)} €/${u}`, ing.priceQuality));
  });

  function ingredientLine(name: string, ref: string, gross: Dec | null, unit: string, amount: Dec | null, formula: string, quality: DataQuality = "measured"): CostLine {
    return {
      group: "ingredients", name, ref,
      quantity: gross === null ? undefined : ser(gross)!,
      unit: UNIT_LABEL[unit],
      amount_batch: ser(amount), amount_portion: ser(perPortion(amount)),
      formula, quality, behavior: "variable", directness: "direct",
    };
  }

  // ----------------------------------------------------------------- energía
  const energyAmounts: (Dec | null)[] = [];
  input.equipment.forEach((eq, i) => {
    const field = `equipment[${i}]`;
    const minutes = dec(eq.minutes);
    const tariff = dec(eq.tariffPricePerUnit);
    const usageShare = dec(eq.usageShare ?? 1);
    const preheatShare = dec(eq.preheatShare ?? 1);
    const preheatMinutes = dec(eq.preheatMinutes ?? 0) ?? new D(0);
    const unit = eq.tariffUnit ?? (eq.source === "electricity" ? "kWh" : eq.source === "gas" ? "kWh" : "m3");

    const push = (amount: Dec | null, formula: string, quality: DataQuality, consumption: Dec | null) => {
      energyAmounts.push(amount);
      lines.push({
        group: "energy", name: eq.name, ref: eq.id,
        quantity: consumption === null ? undefined : ser(consumption)!, unit,
        amount_batch: ser(amount), amount_portion: ser(perPortion(amount)),
        formula, quality, behavior: "variable", directness: "direct",
      });
    };

    if (minutes === null || minutes.lessThan(0)) {
      block({ code: "INVALID_QUANTITY", field: `${field}.minutes`, message: `«${eq.name}»: minutos no válidos.` });
      return push(null, "Minutos pendientes", "estimated", null);
    }
    if (usageShare === null || usageShare.lessThanOrEqualTo(0) || usageShare.greaterThan(1) ||
        preheatShare === null || preheatShare.lessThan(0) || preheatShare.greaterThan(1)) {
      block({ code: "INVALID_SHARE", field, message: `«${eq.name}»: las fracciones de uso y precalentamiento deben estar entre 0 y 1.` });
      return push(null, "Reparto de uso no válido", "estimated", null);
    }
    if (tariff === null) {
      block({ code: "ENERGY_TARIFF_MISSING", field: `${field}.tariffPricePerUnit`, message: `«${eq.name}»: falta asignar una tarifa vigente.` });
    }

    const measured = dec(eq.measuredConsumption ?? null);
    const power = dec(eq.nominalPowerW ?? null);
    let consumption: Dec | null = null;
    let formula: string;
    let quality: DataQuality;

    if (measured !== null) {
      // El consumo medido del proceso sustituye a la estimación nominal.
      consumption = measured.times(usageShare);
      quality = "measured";
      formula = `consumo medido ${fmt(measured)} ${unit}${usageShare.equals(1) ? "" : ` × ${fmt(usageShare)} uso atribuido`}`;
    } else if (eq.source !== "electricity") {
      // Gas y agua tienen sus propias unidades: no se aplica la fórmula eléctrica.
      block({
        code: "ENERGY_NON_ELECTRIC_REQUIRES_MEASURED", field: `${field}.measuredConsumption`,
        message: `«${eq.name}»: para ${eq.source === "gas" ? "gas" : "agua"} indica el consumo medido por tanda en ${unit}.`,
      });
      return push(null, "Consumo medido pendiente", "estimated", null);
    } else if (power === null || power.lessThan(0)) {
      block({ code: "ENERGY_POWER_MISSING", field: `${field}.nominalPowerW`, message: `«${eq.name}»: falta la potencia nominal o un consumo medido.` });
      return push(null, "Potencia pendiente", "estimated", null);
    } else {
      const duty = dec(eq.dutyFactor ?? 1);
      if (duty === null || duty.lessThanOrEqualTo(0) || duty.greaterThan(1)) {
        block({ code: "INVALID_SHARE", field: `${field}.dutyFactor`, message: `«${eq.name}»: el factor de funcionamiento debe estar entre 0 y 1.` });
        return push(null, "Factor de funcionamiento no válido", "estimated", null);
      }
      // kWh = potencia_W / 1000 × minutos / 60 × factor_funcionamiento
      consumption = power.div(1000).times(minutes).div(60).times(duty).times(usageShare);
      quality = worst(eq.powerQuality ?? "manufacturer", eq.dutyFactorQuality ?? "estimated");
      formula = `${fmt(power)} W / 1000 × ${fmt(minutes)} min / 60 × ${fmt(duty)} factor${usageShare.equals(1) ? "" : ` × ${fmt(usageShare)} uso atribuido`} = ${fmt(consumption)} kWh`;
    }

    // Precalentamiento: una vez por tanda/servicio, repartido según la parte atribuida.
    if (preheatMinutes.greaterThan(0) && !(measured !== null && eq.measuredIncludesPreheat)) {
      if (eq.source === "electricity" && power !== null) {
        const preheat = power.div(1000).times(preheatMinutes).div(60).times(preheatShare);
        consumption = consumption!.plus(preheat);
        formula += ` + precalentamiento ${fmt(power)} W / 1000 × ${fmt(preheatMinutes)} min / 60 × ${fmt(preheatShare)} atribuido = ${fmt(preheat)} kWh`;
        quality = worst(quality, "estimated");
        if (!assumptions.includes("El precalentamiento se estima a potencia nominal completa.")) {
          assumptions.push("El precalentamiento se estima a potencia nominal completa.");
        }
      } else {
        warn({
          code: "ENERGY_POWER_MISSING", field: `${field}.preheatMinutes`,
          message: `«${eq.name}»: el precalentamiento no se ha podido estimar; inclúyelo en el consumo medido.`,
        });
      }
    }

    const amount = tariff === null ? null : consumption!.times(tariff);
    push(amount, `${formula} × ${tariff === null ? "tarifa pendiente" : `${fmt(tariff, 8)} €/${unit}`}`, quality, consumption);
  });

  // ---------------------------------------------------------------- personal
  const laborAmounts: (Dec | null)[] = [];
  const laborVariable = input.laborIsVariable === true;
  if (input.labor.length > 0 && !laborVariable) {
    assumptions.push("El personal se considera coste directo fijo: no resta en el margen de contribución.");
  }
  input.labor.forEach((lb, i) => {
    const field = `labor[${i}]`;
    const minutes = dec(lb.activeMinutes);
    const rate = dec(lb.costPerHour);
    let amount: Dec | null = null;
    let formula: string;
    if (minutes === null || minutes.lessThan(0)) {
      block({ code: "INVALID_QUANTITY", field: `${field}.activeMinutes`, message: `«${lb.name}»: minutos no válidos.` });
      formula = "Minutos pendientes";
    } else if (rate === null) {
      block({ code: "LABOR_COST_MISSING", field: `${field}.costPerHour`, message: `«${lb.name}»: falta el coste por hora productiva.` });
      formula = `${fmt(minutes)} min / 60 × coste hora pendiente`;
    } else {
      // coste_trabajo = minutos_activos / 60 × coste_hora
      amount = minutes.div(60).times(rate);
      formula = `${fmt(minutes)} min activos / 60 × ${fmt(rate, 4)} €/h`;
    }
    laborAmounts.push(amount);
    lines.push({
      group: "labor", name: lb.name, ref: lb.id,
      quantity: minutes === null ? undefined : ser(minutes)!, unit: "min",
      amount_batch: ser(amount), amount_portion: ser(perPortion(amount)),
      formula, quality: "measured", behavior: laborVariable ? "variable" : "fixed", directness: "direct",
    });
  });

  // ------------------------------------------------------------- consumibles
  const consumableBatch: (Dec | null)[] = [];
  input.consumables.forEach((c, i) => {
    const amount = dec(c.amount);
    let batch: Dec | null = null;
    let formula: string;
    if (amount === null || amount.lessThan(0)) {
      block({ code: "CONSUMABLE_AMOUNT_MISSING", field: `consumables[${i}].amount`, message: `«${c.name}»: falta el importe.` });
      formula = "Importe pendiente";
    } else if (c.per === "portion") {
      batch = portionsOk ? amount.times(portions!) : null;
      formula = `${fmt(amount, 4)} € por ración`;
    } else {
      batch = amount;
      formula = `${fmt(amount, 4)} € por tanda / raciones`;
    }
    consumableBatch.push(batch);
    lines.push({
      group: "consumables", name: c.name, ref: c.id,
      amount_batch: ser(batch), amount_portion: ser(perPortion(batch)),
      formula, quality: "measured", behavior: "variable", directness: "direct",
    });
  });

  // ----------------------------------------------------------- coste directo
  const batchIngredients = sum(ingredientAmounts);
  const batchEnergy = sum(energyAmounts);
  const batchLabor = sum(laborAmounts);
  const batchConsumables = sum(consumableBatch);
  const batchDirect = sum([batchIngredients, batchEnergy, batchLabor, batchConsumables]);
  const directPerPortion = perPortion(batchDirect);

  // ------------------------------------------------------- gastos indirectos
  const overheads = input.overheadsPerPortion === undefined || input.overheadsPerPortion === null
    ? null
    : dec(input.overheadsPerPortion);
  if (overheads === null) {
    warn({
      code: "OVERHEADS_NOT_CONFIGURED", field: "overheadsPerPortion",
      message: "Sin reparto de gastos generales: se muestra el coste directo, no el coste completo.",
    });
  } else {
    lines.push({
      group: "overheads", name: "Gastos generales asignados",
      amount_batch: ser(portionsOk ? overheads.times(portions!) : null), amount_portion: ser(overheads),
      formula: `${fmt(overheads, 4)} € por ración según regla de reparto`,
      quality: input.overheadsQuality ?? "estimated", behavior: "fixed", directness: "indirect",
    });
  }
  const fullPerPortion = directPerPortion !== null && overheads !== null ? directPerPortion.plus(overheads) : null;

  // ------------------------------------------------------------ rentabilidad
  let netSale: Dec | null = null;
  let channelCosts: Dec | null = null;
  let variableCosts: Dec | null = null;
  let contribution: Dec | null = null;
  let contributionPct: Dec | null = null;
  let markupPct: Dec | null = null;
  let fullMargin: Dec | null = null;
  let fullMarginPct: Dec | null = null;
  let profitCoverage: Coverage = "not_requested";

  if (input.channel) {
    const ch = input.channel;
    const pvp = dec(ch.pvp);
    const rate = dec(ch.taxRate);
    let gross: Dec | null = null;
    let ok = true;
    if (pvp === null || pvp.lessThan(0)) {
      block({ code: "SALE_PRICE_MISSING", field: "channel.pvp", message: `Canal «${ch.name}»: falta el precio de venta.` });
      ok = false;
    }
    if (rate === null || rate.lessThan(0) || rate.greaterThanOrEqualTo(1)) {
      block({ code: "SALE_TAX_MISSING", field: "channel.taxRate", message: `Canal «${ch.name}»: falta el tipo de impuesto de venta (10 % = 0,10).` });
      ok = false;
    }
    if (ok) {
      // venta_neta = PVP / (1 + tipo_impuesto) cuando el PVP incluye un único impuesto porcentual
      netSale = ch.pvpIncludesTax ? pvp!.div(rate!.plus(1)) : pvp!;
      gross = ch.pvpIncludesTax ? pvp! : pvp!.times(rate!.plus(1));
      if (ch.pvpIncludesTax) assumptions.push(`El PVP de «${ch.name}» incluye un único impuesto del ${fmt(rate!.times(100))} %.`);

      const commissionPct = dec(ch.commissionPct ?? 0) ?? new D(0);
      const commissionBase = ch.commissionBase ?? "net";
      const commission = (commissionBase === "net" ? netSale : gross).times(commissionPct);
      const fixedFee = dec(ch.fixedFeePerOrder ?? 0) ?? new D(0);
      const perOrder = dec(ch.portionsPerOrder ?? 1);
      let feePerPortion: Dec | null = new D(0);
      if (fixedFee.greaterThan(0)) {
        if (perOrder === null || perOrder.lessThanOrEqualTo(0)) {
          block({ code: "PORTIONS_PER_ORDER_INVALID", field: "channel.portionsPerOrder", message: "Las raciones por pedido deben ser mayores que cero." });
          feePerPortion = null;
        } else {
          feePerPortion = fixedFee.div(perOrder);
          if (ch.portionsPerOrder === undefined) assumptions.push("La comisión fija por pedido se imputa a una ración por pedido.");
        }
      }
      const packaging = dec(ch.packagingPerPortion ?? 0) ?? new D(0);
      channelCosts = feePerPortion === null ? null : commission.plus(feePerPortion).plus(packaging);

      if (commissionPct.greaterThan(0) || fixedFee.greaterThan(0) || packaging.greaterThan(0)) {
        lines.push({
          group: "channel", name: `Costes del canal ${ch.name}`,
          amount_batch: ser(channelCosts && portionsOk ? channelCosts.times(portions!) : null),
          amount_portion: ser(channelCosts),
          formula: [
            commissionPct.greaterThan(0) ? `${fmt(commissionPct.times(100))} % sobre importe ${commissionBase === "net" ? "neto" : "con impuestos"}` : null,
            fixedFee.greaterThan(0) ? `${fmt(fixedFee, 4)} € por pedido / ${fmt(perOrder)} raciones` : null,
            packaging.greaterThan(0) ? `${fmt(packaging, 4)} € de envase por ración` : null,
          ].filter(Boolean).join(" + "),
          quality: "measured", behavior: "variable", directness: "direct",
        });
      }

      const variableDirect = sum([
        perPortion(batchIngredients), perPortion(batchEnergy), perPortion(batchConsumables),
        laborVariable ? perPortion(batchLabor) : new D(0),
      ]);
      variableCosts = sum([variableDirect, channelCosts]);
      contribution = variableCosts === null ? null : netSale.minus(variableCosts);
      contributionPct = contribution === null ? null : safeDiv(contribution, netSale)?.times(100) ?? null;
      markupPct = directPerPortion === null ? null : safeDiv(netSale.minus(directPerPortion), directPerPortion)?.times(100) ?? null;
      const fullWithChannel = sum([fullPerPortion, channelCosts]);
      fullMargin = fullWithChannel === null ? null : netSale.minus(fullWithChannel);
      fullMarginPct = fullMargin === null ? null : safeDiv(fullMargin, netSale)?.times(100) ?? null;
    }
    profitCoverage = contribution !== null ? "complete" : "incomplete";
  }

  // ------------------------------------------------------------------ estado
  const directCoverage: Coverage = directPerPortion !== null ? "complete" : "incomplete";
  const fullCoverage: Coverage = fullPerPortion !== null ? "complete" : "incomplete";
  const anyEstimated = lines.some((l) => l.quality === "estimated");
  let status: CalculationStatus;
  if (directCoverage === "incomplete" || profitCoverage === "incomplete") status = "incomplete";
  else if (anyEstimated) status = "estimated";
  else status = "complete";

  return {
    status,
    coverage: { direct_cost: directCoverage, full_cost: fullCoverage, profitability: profitCoverage },
    currency: input.currency,
    valuation_date: input.valuationDate,
    portions: portionsOk ? ser(portions) : null,
    batch: {
      ingredients: ser(batchIngredients),
      energy: ser(batchEnergy),
      labor: ser(batchLabor),
      consumables: ser(batchConsumables),
      direct: ser(batchDirect),
    },
    costs: {
      ingredients: ser(perPortion(batchIngredients)),
      energy: ser(perPortion(batchEnergy)),
      labor: ser(perPortion(batchLabor)),
      consumables: ser(perPortion(batchConsumables)),
      direct_per_portion: ser(directPerPortion),
      allocated_overheads: ser(overheads),
      total_per_portion: ser(fullPerPortion),
    },
    profitability: {
      net_sale_price: ser(netSale),
      channel_variable_costs: ser(channelCosts),
      variable_costs: ser(variableCosts),
      contribution_margin: ser(contribution),
      contribution_margin_pct: ser(contributionPct),
      markup_on_direct_cost_pct: ser(markupPct),
      estimated_full_cost_margin: ser(fullMargin),
      estimated_full_cost_margin_pct: ser(fullMarginPct),
    },
    lines,
    missing_inputs: missing,
    assumptions,
    rounding: {
      serialized_decimals: SERIALIZED_DECIMALS,
      mode: "half_up",
      note: "El cálculo interno conserva precisión completa; se redondea solo al serializar y al presentar.",
    },
    calculation_version: ENGINE_VERSION,
  };
}
