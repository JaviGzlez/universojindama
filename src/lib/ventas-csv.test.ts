import { expect, it } from "vitest";
import { leerVentasCsv } from "./ventas-csv";

it("lee el CSV, detecta errores y genera claves estables", () => {
  const csv = "fecha;plato;canal;cantidad;importe\n01/11/2026;Croquetas;Sala;12;96,00\n2026-11-01;Croquetas;Sala;12;96\n31/02/2026;X;Sala;1;1\n02/11/2026;Burger;Glovo;0;10\n";
  const a = leerVentasCsv(csv);
  expect(a.filas).toHaveLength(2);
  expect(a.filas[0]).toMatchObject({ fecha: "2026-11-01", cantidad: 12, importe: 96 });
  expect(a.filas[0].clave).not.toBe(a.filas[1].clave); // filas iguales en el archivo = ventas distintas
  expect(a.errores.map((e) => e.error)).toEqual(["Fecha no válida", "Cantidad no válida"]);
  expect(leerVentasCsv(csv).filas[0].clave).toBe(a.filas[0].clave); // reimportar = misma clave
});
