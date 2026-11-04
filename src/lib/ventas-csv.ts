/**
 * Importación de ventas por plato desde CSV (exportación del TPV o hecho a mano).
 * Columnas: fecha; plato; canal; cantidad; importe (el importe es opcional).
 * Separador «;» o «,» (se detecta). Fechas dd/mm/aaaa o aaaa-mm-dd.
 * Cada fila genera una clave estable: reimportar el mismo archivo no duplica.
 */

export interface FilaVenta {
  linea: number;
  fecha: string;
  plato: string;
  canal: string;
  cantidad: number;
  importe: number | null;
  clave: string;
}

export interface ErrorVenta { linea: number; error: string; texto: string }

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

function numero(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, "");
  if (!t) return null;
  const limpio = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : NaN;
}

function fecha(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function valida(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function hash(s: string) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function leerVentasCsv(texto: string): { filas: FilaVenta[]; errores: ErrorVenta[] } {
  const lineas = texto.replace(/\r/g, "").split("\n");
  const sep = (lineas.find((l) => l.trim()) ?? "").split(";").length >= 4 ? ";" : ",";
  const filas: FilaVenta[] = [];
  const errores: ErrorVenta[] = [];
  const vistas = new Map<string, number>();
  lineas.forEach((l, i) => {
    if (!l.trim()) return;
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /fecha/i.test(c[0] ?? "")) return; // cabecera
    if (c.length < 4) { errores.push({ linea: i + 1, error: "Faltan columnas (fecha; plato; canal; cantidad; importe)", texto: l }); return; }
    const f = fecha(c[0]);
    const cant = numero(c[3]);
    const imp = c[4] !== undefined ? numero(c[4]) : null;
    if (!f) { errores.push({ linea: i + 1, error: "Fecha no válida", texto: l }); return; }
    if (cant === null || Number.isNaN(cant) || cant <= 0) { errores.push({ linea: i + 1, error: "Cantidad no válida", texto: l }); return; }
    if (imp !== null && (Number.isNaN(imp) || imp < 0)) { errores.push({ linea: i + 1, error: "Importe no válido", texto: l }); return; }
    if (!c[1]) { errores.push({ linea: i + 1, error: "Falta el plato", texto: l }); return; }
    // dos filas idénticas en el mismo archivo son ventas distintas: se numeran
    const base = `${f}|${norm(c[1])}|${norm(c[2] ?? "")}|${cant}|${imp ?? ""}`;
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    filas.push({ linea: i + 1, fecha: f, plato: c[1], canal: c[2] ?? "", cantidad: cant, importe: imp, clave: `csv:${hash(`${base}#${n}`)}` });
  });
  return { filas, errores };
}

export const normalizarNombre = norm;
