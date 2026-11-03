import { z } from "zod";
import { api, body } from "@/lib/api/http";
import { calculate, type CalculationInput } from "@/lib/engine";

const num = z.union([z.string(), z.number()]);
const numN = num.nullable();
const quality = z.enum(["measured", "manufacturer", "estimated"]);

const Entrada = z.object({
  currency: z.string().length(3).default("EUR"),
  valuationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  portions: num,
  ingredients: z.array(z.object({
    ingredient: z.object({
      id: z.string(), name: z.string(), baseUnit: z.enum(["g", "ml", "unit"]), yieldRatio: num,
      densityGPerMl: numN.optional(), unitWeightG: numN.optional(), unitVolumeMl: numN.optional(),
      pricePerBaseUnit: numN, priceQuality: quality.optional(),
    }),
    quantity: num, unit: z.enum(["g", "kg", "ml", "l", "unit"]), quantityType: z.enum(["net", "gross"]),
  })).max(200).default([]),
  equipment: z.array(z.object({
    id: z.string().optional(), name: z.string(), source: z.enum(["electricity", "gas", "water"]), minutes: num,
    nominalPowerW: numN.optional(), powerQuality: quality.optional(), dutyFactor: num.optional(), dutyFactorQuality: quality.optional(),
    measuredConsumption: numN.optional(), measuredIncludesPreheat: z.boolean().optional(), preheatMinutes: num.optional(),
    preheatShare: num.optional(), usageShare: num.optional(), tariffPricePerUnit: numN, tariffUnit: z.string().optional(),
  })).max(50).default([]),
  labor: z.array(z.object({ id: z.string().optional(), name: z.string(), activeMinutes: num, costPerHour: numN })).max(50).default([]),
  consumables: z.array(z.object({ id: z.string().optional(), name: z.string(), amount: numN, per: z.enum(["portion", "batch"]) })).max(50).default([]),
  overheadsPerPortion: numN.optional(),
  overheadsQuality: quality.optional(),
  laborIsVariable: z.boolean().optional(),
  channel: z.object({
    name: z.string(), pvp: numN, pvpIncludesTax: z.boolean(), taxRate: numN, commissionPct: num.optional(),
    commissionBase: z.enum(["net", "gross"]).optional(), fixedFeePerOrder: num.optional(), portionsPerOrder: num.optional(),
    packagingPerPortion: num.optional(),
  }).optional(),
});

/**
 * POST /api/v1/calculate — cálculo sin estado: recibe datos ya resueltos y
 * devuelve el contrato de la sección 17. No lee ni escribe catálogos.
 * El cálculo sobre versiones de receta guardadas llega en la fase 2.
 */
export const POST = api(async ({ request }) => {
  const input = (await body(request, Entrada)) as CalculationInput;
  return calculate(input);
});
