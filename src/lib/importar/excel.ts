import ExcelJS from "exceljs";
import type { Hoja } from "./analitica";

/** Convierte un .xlsx en hojas con valores ya calculados (resultado de las fórmulas). */
export async function leerLibro(buffer: ArrayBuffer): Promise<Hoja[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((ws) => ({
    nombre: ws.name,
    filas: ws.rowCount,
    columnas: ws.columnCount,
    valor(fila: number, col: number) {
      const v = ws.getRow(fila).getCell(col).value as unknown;
      if (v === null || v === undefined) return null;
      if (typeof v === "object") {
        const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
        if ("result" in o) return o.result ?? null;
        if (o.richText) return o.richText.map((r) => r.text).join("");
        if (o.text !== undefined) return o.text;
        if (o.error) return null;
        if (v instanceof Date) return v.toISOString();
      }
      return v;
    },
  }));
}
