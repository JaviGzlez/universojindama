import { expect, it } from "vitest";
import { calcularFactura } from "./compras";

const ings = {
  aceite: { id: "aceite", name: "Aceite", baseUnit: "ml" as const, yieldRatio: "1", pricePerBaseUnit: null },
  huevo: { id: "huevo", name: "Huevo", baseUnit: "unit" as const, yieldRatio: "1", pricePerBaseUnit: null },
  harina: { id: "harina", name: "Harina", baseUnit: "g" as const, yieldRatio: "1", pricePerBaseUnit: null },
};

it("convierte envases a unidad base y reparte descuento y portes", () => {
  const r = calcularFactura([
    { id: "1", ingredient_id: "aceite", description: "Garrafa 5 l", packs: "3", pack_quantity: "5", pack_unit: "l", pack_price: "30", discount_pct: "10", tax_rate: "0.10" },
    { id: "2", ingredient_id: "huevo", description: "Bandeja 30", packs: "1", pack_quantity: "30", pack_unit: "unit", pack_price: "9", discount_pct: "0", tax_rate: "0.04" },
  ], { discount_total: "0", shipping: "9" }, ings);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  // líneas: 81 + 9 = 90; portes 9 → 8,10 y 0,90
  expect(r.lineas[0]).toMatchObject({ base_quantity: "15000", line_net: "89.1", price_per_base_unit: "0.00594" });
  expect(r.lineas[1]).toMatchObject({ base_quantity: "30", line_net: "9.9", price_per_base_unit: "0.33" });
  expect(r.neto).toBe("99.00");
  expect(r.impuestos).toBe("9.31"); // 8,91 + 0,396
});

it("exige conversión documentada y materia prima", () => {
  const r = calcularFactura([
    { id: "1", ingredient_id: "harina", description: "Saco", packs: "1", pack_quantity: "1", pack_unit: "l", pack_price: "5", discount_pct: "0", tax_rate: "0" },
    { id: "2", ingredient_id: null, description: "Varios", packs: "1", pack_quantity: "1", pack_unit: "unit", pack_price: "5", discount_pct: "0", tax_rate: "0" },
  ], { discount_total: "0", shipping: "0" }, ings);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.errores).toHaveLength(2);
  expect(r.errores[0]).toContain("densidad");
});
