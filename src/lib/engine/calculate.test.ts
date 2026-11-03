import { describe, expect, it } from "vitest";
import { calculate } from "./calculate";
import type { CalculationInput, IngredientRef } from "./types";

const base = (over: Partial<CalculationInput> = {}): CalculationInput => ({
  currency: "EUR",
  valuationDate: "2026-11-03",
  portions: 10,
  ingredients: [],
  equipment: [],
  labor: [],
  consumables: [],
  overheadsPerPortion: null,
  ...over,
});

const ing = (over: Partial<IngredientRef> = {}): IngredientRef => ({
  id: "ing",
  name: "Patata",
  baseUnit: "g",
  yieldRatio: "1",
  pricePerBaseUnit: "0.002",
  ...over,
});

describe("materia prima", () => {
  it("aplica el rendimiento a la cantidad neta: 100 g netos al 80 % = 125 g brutos", () => {
    const r = calculate(base({
      ingredients: [{ ingredient: ing({ yieldRatio: "0.80", pricePerBaseUnit: "0.004" }), quantity: 100, unit: "g", quantityType: "net" }],
    }));
    expect(r.lines[0].quantity).toBe("125.000000");
    expect(r.batch.ingredients).toBe("0.500000");
    expect(r.costs.ingredients).toBe("0.050000");
  });

  it("no aplica la merma dos veces si la cantidad ya es bruta", () => {
    const r = calculate(base({
      ingredients: [{ ingredient: ing({ yieldRatio: "0.80", pricePerBaseUnit: "0.004" }), quantity: 125, unit: "g", quantityType: "gross" }],
    }));
    expect(r.batch.ingredients).toBe("0.500000");
  });

  it("convierte kg y l a la unidad base", () => {
    const r = calculate(base({
      portions: 1,
      ingredients: [
        { ingredient: ing({ pricePerBaseUnit: "0.002" }), quantity: "1,5", unit: "kg", quantityType: "gross" },
        { ingredient: ing({ id: "aceite", name: "Aceite", baseUnit: "ml", pricePerBaseUnit: "0.0065" }), quantity: "0.2", unit: "l", quantityType: "gross" },
      ],
    }));
    expect(r.batch.ingredients).toBe("4.300000"); // 1500 × 0,002 + 200 × 0,0065
  });

  it("exige densidad para convertir entre masa y volumen", () => {
    const sinDensidad = calculate(base({
      ingredients: [{ ingredient: ing({ baseUnit: "ml" }), quantity: 100, unit: "g", quantityType: "gross" }],
    }));
    expect(sinDensidad.status).toBe("incomplete");
    expect(sinDensidad.missing_inputs[0].code).toBe("UNIT_CONVERSION_DENSITY_MISSING");

    const conDensidad = calculate(base({
      portions: 1,
      ingredients: [{ ingredient: ing({ baseUnit: "ml", densityGPerMl: "0.92", pricePerBaseUnit: "0.0092" }), quantity: 92, unit: "g", quantityType: "gross" }],
    }));
    expect(conDensidad.batch.ingredients).toBe("0.920000"); // 92 g / 0,92 = 100 ml × 0,0092
  });

  it("exige peso unitario documentado para convertir unidades", () => {
    const r = calculate(base({
      ingredients: [{ ingredient: ing({ baseUnit: "g" }), quantity: 2, unit: "unit", quantityType: "gross" }],
    }));
    expect(r.missing_inputs.map((m) => m.code)).toContain("UNIT_CONVERSION_UNIT_WEIGHT_MISSING");
  });

  it("un precio desconocido no equivale a cero", () => {
    const r = calculate(base({
      ingredients: [
        { ingredient: ing(), quantity: 100, unit: "g", quantityType: "gross" },
        { ingredient: ing({ id: "x", name: "Trufa", pricePerBaseUnit: null }), quantity: 5, unit: "g", quantityType: "gross" },
      ],
    }));
    expect(r.status).toBe("incomplete");
    expect(r.costs.ingredients).toBeNull();
    expect(r.costs.direct_per_portion).toBeNull();
    expect(r.missing_inputs.find((m) => m.code === "INGREDIENT_PRICE_MISSING")?.field).toBe("ingredients[1].pricePerBaseUnit");
  });

  it("rechaza rendimientos fuera de rango", () => {
    const r = calculate(base({ ingredients: [{ ingredient: ing({ yieldRatio: "80" }), quantity: 1, unit: "g", quantityType: "net" }] }));
    expect(r.missing_inputs[0].code).toBe("INVALID_YIELD");
  });

  it("usa decimales exactos (0,1 + 0,2 = 0,3)", () => {
    const r = calculate(base({
      portions: 1,
      consumables: [
        { name: "a", amount: "0.1", per: "batch" },
        { name: "b", amount: "0.2", per: "batch" },
      ],
    }));
    expect(r.batch.consumables).toBe("0.300000");
  });
});

describe("energía", () => {
  it("ejemplo del documento: 3.000 W × 30 min × factor 1 a 0,20 €/kWh = 0,30 € por tanda, 0,03 € por ración", () => {
    const r = calculate(base({
      equipment: [{ name: "Horno", source: "electricity", minutes: 30, nominalPowerW: 3000, dutyFactor: 1, dutyFactorQuality: "measured", powerQuality: "measured", tariffPricePerUnit: "0.20" }],
    }));
    expect(r.lines[0].quantity).toBe("1.500000");
    expect(r.batch.energy).toBe("0.300000");
    expect(r.costs.energy).toBe("0.030000");
  });

  it("marca como estimado el uso de un factor de funcionamiento estimado", () => {
    const r = calculate(base({
      equipment: [{ name: "Horno", source: "electricity", minutes: 30, nominalPowerW: 3000, dutyFactor: "0.5", tariffPricePerUnit: "0.20" }],
    }));
    expect(r.batch.energy).toBe("0.150000");
    expect(r.status).toBe("estimated");
  });

  it("el consumo medido sustituye a la estimación nominal", () => {
    const r = calculate(base({
      equipment: [{ name: "Horno", source: "electricity", minutes: 30, nominalPowerW: 3000, measuredConsumption: "1.1", tariffPricePerUnit: "0.20" }],
    }));
    expect(r.batch.energy).toBe("0.220000");
    expect(r.lines[0].quality).toBe("measured");
  });

  it("reparte el precalentamiento una sola vez según la parte atribuida", () => {
    const r = calculate(base({
      equipment: [{
        name: "Horno", source: "electricity", minutes: 30, nominalPowerW: 3000, dutyFactor: 1,
        preheatMinutes: 20, preheatShare: "0.5", tariffPricePerUnit: "0.20",
      }],
    }));
    // 1,5 kWh + 3 kW × 20/60 h × 0,5 = 0,5 kWh → 2 kWh × 0,20
    expect(r.batch.energy).toBe("0.400000");
    expect(r.status).toBe("estimated");
  });

  it("reparte el uso de un equipo compartido sin atribuir el consumo completo", () => {
    const r = calculate(base({
      equipment: [{ name: "Horno", source: "electricity", minutes: 30, nominalPowerW: 3000, usageShare: "0.25", tariffPricePerUnit: "0.20" }],
    }));
    expect(r.batch.energy).toBe("0.075000");
  });

  it("no aplica la fórmula eléctrica a gas o agua", () => {
    const r = calculate(base({
      equipment: [{ name: "Fogón", source: "gas", minutes: 20, nominalPowerW: 5000, tariffPricePerUnit: "0.08" }],
    }));
    expect(r.status).toBe("incomplete");
    expect(r.missing_inputs[0].code).toBe("ENERGY_NON_ELECTRIC_REQUIRES_MEASURED");

    const medido = calculate(base({
      equipment: [{ name: "Fogón", source: "gas", minutes: 20, measuredConsumption: "1.5", tariffPricePerUnit: "0.08", tariffUnit: "kWh" }],
    }));
    expect(medido.batch.energy).toBe("0.120000");
  });

  it("sin tarifa el coste queda pendiente, no a cero", () => {
    const r = calculate(base({
      equipment: [{ name: "Horno", source: "electricity", minutes: 30, nominalPowerW: 3000, tariffPricePerUnit: null }],
    }));
    expect(r.costs.energy).toBeNull();
    expect(r.missing_inputs[0].code).toBe("ENERGY_TARIFF_MISSING");
  });
});

describe("personal", () => {
  it("coste_trabajo = minutos activos / 60 × coste hora, repartido entre raciones", () => {
    const r = calculate(base({ labor: [{ name: "Cocinero", activeMinutes: 45, costPerHour: "16" }] }));
    expect(r.batch.labor).toBe("12.000000");
    expect(r.costs.labor).toBe("1.200000");
    expect(r.lines[0].behavior).toBe("fixed");
  });

  it("sin coste hora el cálculo es incompleto", () => {
    const r = calculate(base({ labor: [{ name: "Ayudante", activeMinutes: 10, costPerHour: null }] }));
    expect(r.missing_inputs[0].code).toBe("LABOR_COST_MISSING");
  });
});

describe("coste por ración y rentabilidad", () => {
  const plato = (over: Partial<CalculationInput> = {}) => base({
    portions: 4,
    ingredients: [{ ingredient: ing({ pricePerBaseUnit: "0.01" }), quantity: 400, unit: "g", quantityType: "gross" }], // 4 €
    labor: [{ name: "Cocinero", activeMinutes: 15, costPerHour: "16" }], // 4 €
    consumables: [{ name: "Envase", amount: "0.25", per: "portion" }], // 1 €
    ...over,
  });

  it("rechaza raciones cero sin dividir por cero", () => {
    const r = calculate(plato({ portions: 0 }));
    expect(r.status).toBe("incomplete");
    expect(r.costs.direct_per_portion).toBeNull();
    expect(r.missing_inputs[0].code).toBe("PORTIONS_INVALID");
  });

  it("calcula coste directo por ración y avisa si no hay reparto de gastos", () => {
    const r = calculate(plato());
    expect(r.costs.direct_per_portion).toBe("2.250000"); // 9 € / 4
    expect(r.costs.total_per_portion).toBeNull();
    expect(r.coverage.full_cost).toBe("incomplete");
    expect(r.status).toBe("complete");
    expect(r.missing_inputs.find((m) => m.code === "OVERHEADS_NOT_CONFIGURED")?.severity).toBe("warning");
  });

  it("suma gastos indirectos asignados al coste completo", () => {
    const r = calculate(plato({ overheadsPerPortion: "0.75" }));
    expect(r.costs.total_per_portion).toBe("3.000000");
    expect(r.status).toBe("estimated"); // reparto por previsión
  });

  it("separa venta neta, margen de contribución, margen sobre venta y recargo sobre coste", () => {
    const r = calculate(plato({
      overheadsPerPortion: "0.75",
      channel: { name: "Sala", pvp: "11", pvpIncludesTax: true, taxRate: "0.10" },
    }));
    expect(r.profitability.net_sale_price).toBe("10.000000");
    // variables: materia prima 1 + consumibles 0,25 (personal fijo)
    expect(r.profitability.variable_costs).toBe("1.250000");
    expect(r.profitability.contribution_margin).toBe("8.750000");
    expect(r.profitability.contribution_margin_pct).toBe("87.500000");
    // recargo sobre coste directo: (10 - 2,25) / 2,25
    expect(r.profitability.markup_on_direct_cost_pct).toBe("344.444444");
    expect(r.profitability.estimated_full_cost_margin).toBe("7.000000");
    expect(r.profitability.estimated_full_cost_margin_pct).toBe("70.000000");
  });

  it("aplica comisiones de plataforma con base explícita y comisión fija por pedido", () => {
    const r = calculate(plato({
      channel: {
        name: "Plataforma", pvp: "11", pvpIncludesTax: true, taxRate: "0.10",
        commissionPct: "0.30", commissionBase: "gross", fixedFeePerOrder: "1", portionsPerOrder: 2, packagingPerPortion: "0.20",
      },
    }));
    // 11 × 0,30 + 1 / 2 + 0,20 = 4
    expect(r.profitability.channel_variable_costs).toBe("4.000000");
    expect(r.profitability.contribution_margin).toBe("4.750000");
  });

  it("no calcula porcentajes con venta neta cero", () => {
    const r = calculate(plato({ channel: { name: "Invitación", pvp: "0", pvpIncludesTax: true, taxRate: "0.10" } }));
    expect(r.profitability.net_sale_price).toBe("0.000000");
    expect(r.profitability.contribution_margin_pct).toBeNull();
  });

  it("sin precio de venta la rentabilidad queda incompleta", () => {
    const r = calculate(plato({ channel: { name: "Sala", pvp: null, pvpIncludesTax: true, taxRate: "0.10" } }));
    expect(r.coverage.profitability).toBe("incomplete");
    expect(r.status).toBe("incomplete");
    expect(r.profitability.contribution_margin).toBeNull();
  });

  it("incluye fórmula y detalle de cada línea", () => {
    const r = calculate(plato());
    expect(r.lines).toHaveLength(3);
    for (const l of r.lines) expect(l.formula.length).toBeGreaterThan(0);
    expect(r.calculation_version).toBe("1");
  });
});
