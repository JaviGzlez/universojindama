import { expect, it } from "vitest";
import { consumoPorRacion } from "./inventario";

it("despliega elaboraciones y aplica mermas al consumo teórico por ración", () => {
  const ings = {
    tom: { id: "tom", name: "Tomate", baseUnit: "g" as const, yieldRatio: "0.8", pricePerBaseUnit: null },
    pasta: { id: "pasta", name: "Pasta", baseUnit: "g" as const, yieldRatio: "1", pricePerBaseUnit: null },
  };
  const salsa = { kind: "preparation" as const, portions: null, yield_quantity: "1000", yield_unit: "g" as const,
    ingredientes: [{ ingredient_id: "tom", sub_recipe_id: null, quantity: "960", unit: "g" as const, quantity_type: "net" as const }] };
  const plato = { kind: "dish" as const, portions: "4", yield_quantity: null, yield_unit: null,
    ingredientes: [
      { ingredient_id: "pasta", sub_recipe_id: null, quantity: "0.4", unit: "kg" as const, quantity_type: "gross" as const },
      { ingredient_id: null, sub_recipe_id: "salsa", quantity: "500", unit: "g" as const, quantity_type: "gross" as const },
    ] };
  const r = consumoPorRacion(plato, ings, { salsa }, new Set());
  expect(r.get("pasta")?.toString()).toBe("100");
  expect(r.get("tom")?.toString()).toBe("150"); // (960/0,8 = 1200 g por 1000 g de salsa) × 500 g / 4
});
