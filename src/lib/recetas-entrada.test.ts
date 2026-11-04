import { expect, it } from "vitest";
import { calcularDesdeCatalogo, type CatalogoPlano, type VersionEditable } from "./recetas-entrada";

const cat: CatalogoPlano = {
  ingredientes: { tom: { id: "tom", name: "Tomate", baseUnit: "g", yieldRatio: "0.8", pricePerBaseUnit: "0.002" } },
  equipos: {}, perfiles: { coc: { name: "Cocinero", costPerHour: "18" } }, consumibles: {},
  subrecetas: {}, overheads: { value: "0.5", detalle: "prueba" },
};
const vacia = { equipos: [], personal: [], consumibles: [], labor_is_variable: false, use_overheads: true, yield_unit: null, yield_quantity: null, portions: null };

it("una elaboración da coste por unidad base y un plato la usa sin volver a sumar sus ingredientes", () => {
  const salsa: VersionEditable = {
    ...vacia, kind: "preparation", yield_quantity: "1000", yield_unit: "g",
    ingredientes: [{ ingredient_id: "tom", sub_recipe_id: null, quantity: "960", unit: "g", quantity_type: "net" }], // 1200 g brutos
  };
  const r1 = calcularDesdeCatalogo(salsa, cat).result;
  expect(r1.costs.direct_per_portion).toBe("0.002400"); // 2,40 € / 1000 g
  expect(r1.coverage.full_cost).toBe("not_requested");

  const cat2 = { ...cat, subrecetas: { salsa: { name: "Salsa", baseUnit: "g" as const, costPerUnit: r1.costs.direct_per_portion, status: r1.status } } };
  const plato: VersionEditable = {
    ...vacia, kind: "dish", portions: "4",
    ingredientes: [{ ingredient_id: null, sub_recipe_id: "salsa", quantity: "0.3", unit: "kg", quantity_type: "net" }],
    personal: [{ labor_profile_id: "coc", active_minutes: "10" }],
  };
  const r2 = calcularDesdeCatalogo(plato, cat2, { name: "Sala", pvp: "11", pvpIncludesTax: true, taxRate: "0.10" }).result;
  expect(r2.costs.ingredients).toBe("0.180000");          // 300 g × 0,0024 / 4 (sin aplicar otra vez la merma)
  expect(r2.costs.labor).toBe("0.750000");                // 10 min × 18 €/h / 4
  expect(r2.costs.total_per_portion).toBe("1.430000");    // + 0,50 gastos generales
  expect(r2.profitability.net_sale_price).toBe("10.000000");
});

it("una elaboración sin versión activa deja el plato incompleto", () => {
  const cat2 = { ...cat, subrecetas: { x: { name: "Fondo", baseUnit: "ml" as const, costPerUnit: null, status: "sin_version" as const } } };
  const r = calcularDesdeCatalogo({ ...vacia, kind: "dish", portions: "2", ingredientes: [{ ingredient_id: null, sub_recipe_id: "x", quantity: "100", unit: "ml", quantity_type: "net" }] }, cat2);
  expect(r.result.status).toBe("incomplete");
  expect(r.avisos[0]).toContain("Fondo");
});
