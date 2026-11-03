/**
 * Contrato del motor de cálculo de Universo Jindama.
 * Los importes y cantidades viajan como cadenas (o números de entrada) y se
 * calculan con decimales exactos. Un dato desconocido es `null`, nunca 0.
 */

export type Num = string | number;

export type DataQuality = "measured" | "manufacturer" | "estimated";
export type BaseUnit = "g" | "ml" | "unit";
export type QuantityUnit = "g" | "kg" | "ml" | "l" | "unit";
export type EnergySource = "electricity" | "gas" | "water";

export interface IngredientRef {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  /** Rendimiento aprovechable: 80 % = 0.80 */
  yieldRatio: Num;
  densityGPerMl?: Num | null;
  unitWeightG?: Num | null;
  unitVolumeMl?: Num | null;
  /** Precio por unidad base (€/g, €/ml o €/unidad). null = sin precio */
  pricePerBaseUnit: Num | null;
  priceQuality?: DataQuality;
}

export interface IngredientLine {
  ingredient: IngredientRef;
  quantity: Num;
  unit: QuantityUnit;
  /** net = cantidad aprovechable (se aplica rendimiento); gross = ya bruta */
  quantityType: "net" | "gross";
}

export interface EquipmentLine {
  id?: string;
  name: string;
  source: EnergySource;
  /** Minutos de uso en la tanda */
  minutes: Num;
  nominalPowerW?: Num | null;
  powerQuality?: DataQuality;
  dutyFactor?: Num;
  dutyFactorQuality?: DataQuality;
  /** Consumo medido del proceso para esta tanda, en la unidad de la tarifa */
  measuredConsumption?: Num | null;
  measuredIncludesPreheat?: boolean;
  preheatMinutes?: Num;
  /** Parte del precalentamiento atribuida a esta tanda (0–1). Por defecto 1 */
  preheatShare?: Num;
  /** Parte del uso del equipo atribuida a esta tanda si cocina varias cosas a la vez (0–1). Por defecto 1 */
  usageShare?: Num;
  tariffPricePerUnit: Num | null;
  tariffUnit?: string;
}

export interface LaborLine {
  id?: string;
  name: string;
  /** Minutos de dedicación activa a la tanda (no tiempo de cocción) */
  activeMinutes: Num;
  costPerHour: Num | null;
}

export interface ConsumableLine {
  id?: string;
  name: string;
  amount: Num | null;
  per: "portion" | "batch";
}

export interface ChannelInput {
  name: string;
  pvp: Num | null;
  pvpIncludesTax: boolean;
  /** 10 % = 0.10 */
  taxRate: Num | null;
  /** 30 % = 0.30 */
  commissionPct?: Num;
  commissionBase?: "net" | "gross";
  fixedFeePerOrder?: Num;
  portionsPerOrder?: Num;
  packagingPerPortion?: Num;
}

export interface CalculationInput {
  currency: string;
  valuationDate: string;
  /** Raciones vendibles que produce la tanda */
  portions: Num;
  ingredients: IngredientLine[];
  equipment: EquipmentLine[];
  labor: LaborLine[];
  consumables: ConsumableLine[];
  /** Gastos generales asignados por ración. undefined/null = sin reparto configurado */
  overheadsPerPortion?: Num | null;
  overheadsQuality?: DataQuality;
  /** El personal se trata como coste fijo salvo que se indique lo contrario */
  laborIsVariable?: boolean;
  channel?: ChannelInput;
}

export type CalculationStatus = "complete" | "estimated" | "incomplete";
export type Coverage = "complete" | "incomplete" | "not_requested";

export interface MissingInput {
  code: MissingCode;
  severity: "blocking" | "warning";
  field: string;
  message: string;
}

export type MissingCode =
  | "PORTIONS_INVALID"
  | "INVALID_QUANTITY"
  | "INVALID_YIELD"
  | "INGREDIENT_PRICE_MISSING"
  | "UNIT_CONVERSION_DENSITY_MISSING"
  | "UNIT_CONVERSION_UNIT_WEIGHT_MISSING"
  | "UNIT_CONVERSION_UNIT_VOLUME_MISSING"
  | "ENERGY_TARIFF_MISSING"
  | "ENERGY_POWER_MISSING"
  | "ENERGY_NON_ELECTRIC_REQUIRES_MEASURED"
  | "INVALID_SHARE"
  | "LABOR_COST_MISSING"
  | "CONSUMABLE_AMOUNT_MISSING"
  | "OVERHEADS_NOT_CONFIGURED"
  | "SALE_PRICE_MISSING"
  | "SALE_TAX_MISSING"
  | "PORTIONS_PER_ORDER_INVALID";

export type LineGroup = "ingredients" | "energy" | "labor" | "consumables" | "overheads" | "channel";

export interface CostLine {
  group: LineGroup;
  name: string;
  ref?: string;
  quantity?: string;
  unit?: string;
  amount_batch: string | null;
  amount_portion: string | null;
  formula: string;
  quality: DataQuality;
  behavior: "variable" | "fixed";
  directness: "direct" | "indirect";
}

export interface CalculationResult {
  status: CalculationStatus;
  coverage: { direct_cost: Coverage; full_cost: Coverage; profitability: Coverage };
  currency: string;
  valuation_date: string;
  portions: string | null;
  batch: {
    ingredients: string | null;
    energy: string | null;
    labor: string | null;
    consumables: string | null;
    direct: string | null;
  };
  costs: {
    ingredients: string | null;
    energy: string | null;
    labor: string | null;
    consumables: string | null;
    direct_per_portion: string | null;
    allocated_overheads: string | null;
    total_per_portion: string | null;
  };
  profitability: {
    net_sale_price: string | null;
    channel_variable_costs: string | null;
    variable_costs: string | null;
    contribution_margin: string | null;
    contribution_margin_pct: string | null;
    markup_on_direct_cost_pct: string | null;
    estimated_full_cost_margin: string | null;
    estimated_full_cost_margin_pct: string | null;
  };
  lines: CostLine[];
  missing_inputs: MissingInput[];
  assumptions: string[];
  rounding: { serialized_decimals: number; mode: "half_up"; note: string };
  calculation_version: string;
}
