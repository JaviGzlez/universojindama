import { describe, expect, it } from "vitest";
import { leerAnalitica, type Hoja } from "./analitica";

/** Hoja sintética con la misma estructura que el Excel de analítica (sin datos reales). */
function hoja(nombre: string, celdas: Record<string, unknown>): Hoja {
  const col = (l: string) => [...l].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  const m = new Map<string, unknown>();
  let filas = 0, columnas = 0;
  for (const [ref, v] of Object.entries(celdas)) {
    const [, l, f] = ref.match(/^([A-Z]+)(\d+)$/)!;
    m.set(`${f}:${col(l)}`, v);
    filas = Math.max(filas, Number(f));
    columnas = Math.max(columnas, col(l));
  }
  return { nombre, filas, columnas, valor: (f, c) => m.get(`${f}:${c}`) ?? null };
}

const bloque = (o: number, titulo: string, extra: Record<string, unknown> = {}) => ({
  [`G${o}`]: titulo,
  [`B${o + 3}`]: "DIA", [`C${o + 3}`]: "MAKRO", [`D${o + 3}`]: "VARIOS", [`E${o + 3}`]: "TOTAL ",
  [`F${o + 3}`]: "DIA", [`I${o + 3}`]: "SUELDOS Y SALARIOS", [`G${o + 4}`]: "NOMBRE", [`H${o + 4}`]: "SUELDO",
  [`J${o + 3}`]: "DIA", [`K${o + 3}`]: "INGRESOS EFECTIVO", [`L${o + 3}`]: "INGRESOS TARJETAS", [`M${o + 3}`]: "TOTAL ",
  [`N${o + 3}`]: "DIA", [`O${o + 3}`]: "LUZ", [`P${o + 3}`]: "PRESTAMOS", [`Q${o + 3}`]: "TOTAL ",
  [`B${o + 5}`]: 1, [`F${o + 5}`]: 1, [`J${o + 5}`]: 1, [`N${o + 5}`]: 1,
  [`B${o + 6}`]: 30, [`F${o + 6}`]: 30, [`J${o + 6}`]: 30, [`N${o + 6}`]: 30,
  [`C${o + 5}`]: 100.5, [`D${o + 6}`]: "20,25",
  [`G${o + 5}`]: "PERSONA UNO", [`H${o + 5}`]: 1000, [`G${o + 6}`]: "SEGURIDAD SOCIAL", [`H${o + 6}`]: 300,
  [`K${o + 5}`]: 500, [`L${o + 6}`]: 700,
  [`O${o + 5}`]: 80, [`P${o + 6}`]: 1000,
  [`A${o + 8}`]: "     TOTALES", [`C${o + 8}`]: 100.5, [`D${o + 8}`]: 10,
  ...extra,
});

describe("importador de analítica", () => {
  const r = leerAnalitica([
    hoja("FEBRERO", { ...bloque(5, "ANALITICA GESTION JINDAMA JEREZ"), ...bloque(51, "ANALITICA GESTION JALEO JEREZ"), ...bloque(96, "ANALITICA GESTION JALEO JEREZ") }),
    hoja("GENERAL", { A1: "resumen" }),
  ], 2026);

  it("detecta los bloques y propone restaurante por posición avisando del título", () => {
    expect(r.bloques.map((b) => b.sugerido)).toEqual(["jindama", "jaleo", "juye"]);
    expect(r.bloques[2].avisos.some((a) => a.includes("se titula"))).toBe(true);
  });

  it("clasifica compras, ingresos, gastos y financiación", () => {
    const b1 = r.filas.filter((f) => f.block === 1);
    expect(b1.find((f) => f.cell === "C10")).toMatchObject({ kind: "purchase", counterparty: "Makro", amount: 100.5, entry_date: "2026-02-01" });
    expect(b1.find((f) => f.cell === "K10")).toMatchObject({ kind: "revenue", channel: "Efectivo", amount: 500 });
    expect(b1.find((f) => f.cell === "O10")).toMatchObject({ kind: "expense", nature: "operating", category: "Luz" });
    expect(b1.find((f) => f.cell === "P11")).toMatchObject({ kind: "expense", nature: "financing" });
  });

  it("lleva los días inexistentes al último día del mes, con aviso", () => {
    expect(r.filas.find((f) => f.block === 1 && f.cell === "L11")?.entry_date).toBe("2026-02-28");
    expect(r.bloques[0].avisos.some((a) => a.includes("día 30"))).toBe(true);
  });

  it("acepta coma decimal y avisa si no cuadra con la fila TOTALES", () => {
    expect(r.filas.find((f) => f.block === 1 && f.cell === "D11")?.amount).toBe(20.25);
    expect(r.bloques[0].avisos.some((a) => a.includes("VARIOS"))).toBe(true);
  });

  it("importa el personal solo como totales, sin nombres", () => {
    const personal = r.filas.filter((f) => f.block === 1 && f.kind === "labor");
    expect(personal.map((f) => [f.category, f.amount])).toEqual([["Sueldos y salarios", 1000], ["Seguridad Social", 300]]);
    expect(JSON.stringify(r.filas)).not.toContain("PERSONA UNO");
  });

  it("ignora la hoja GENERAL", () => {
    expect(r.filas.some((f) => f.sheet === "GENERAL")).toBe(false);
  });
});
