/**
 * Lector del Excel «ANALITICA <año> JINDAMA JALEO».
 *
 * Cada hoja mensual (ENERO…DICIEMBRE) tiene un bloque por restaurante, que
 * empieza con un título «ANALITICA GESTION <LOCAL> JEREZ». Bajo una fila de
 * cabecera, cada grupo de columnas empieza con «DIA»:
 *   1. Proveedores (una columna por proveedor) → compras por día
 *   2. Personal (nombre, sueldo, S.S.)          → SOLO totales del mes, sin nombres
 *   3. Ingresos (efectivo, tarjetas, plataformas…) → ingresos por día
 *   4+. Gastos fijos y variables (alquiler, luz… préstamos, inversión) → gastos por día
 *
 * La hoja GENERAL son resúmenes calculados y no se importa (evita duplicar).
 * Este módulo no toca la base de datos: produce filas trazables (hoja, celda,
 * dato original, transformación, error) para revisarlas antes de aplicar.
 */

export interface Hoja {
  nombre: string;
  filas: number;
  columnas: number;
  valor(fila: number, col: number): unknown;
}

export type Tipo = "revenue" | "purchase" | "labor" | "expense";
export type Naturaleza = "operating" | "financing" | "investment";

export interface FilaImportada {
  block: number;
  sheet: string;
  cell: string;
  original: string | null;
  entry_date: string | null;
  kind: Tipo | null;
  nature: Naturaleza | null;
  category: string | null;
  counterparty: string | null;
  channel: string | null;
  amount: number | null;
  status: "ok" | "error";
  error: string | null;
}

export interface BloqueResumen {
  block: number;
  titulos: string[];                // títulos encontrados en cada mes
  sugerido: "jindama" | "jaleo" | "juye" | null;
  meses: string[];
  totales: Record<Tipo, number>;
  avisos: string[];
}

export interface ResultadoLectura {
  year: number;
  filas: FilaImportada[];
  bloques: BloqueResumen[];
  avisos: string[];
}

export const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];

export function columnaLetra(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const norm = (v: unknown) => texto(v).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function numero(v: unknown): { ok: true; n: number | null } | { ok: false } {
  if (v === null || v === undefined || v === "") return { ok: true, n: null };
  if (typeof v === "number") return Number.isFinite(v) ? { ok: true, n: v } : { ok: false };
  const s = String(v).trim().replace(/\s|€/g, "");
  if (s === "" || s === "-") return { ok: true, n: null };
  const limpio = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? { ok: true, n } : { ok: false };
}

const redondear = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

function capitalizar(s: string) {
  const t = s.toLowerCase().replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sugerencia(titulo: string): BloqueResumen["sugerido"] {
  const t = norm(titulo);
  if (t.includes("JUYE")) return "juye";
  if (t.includes("JALEO")) return "jaleo";
  if (t.includes("JINDAMA")) return "jindama";
  return null;
}

function canalIngreso(etiqueta: string) {
  const t = norm(etiqueta);
  if (t.includes("EFECTIVO")) return "Efectivo";
  if (t.includes("TARJETA")) return "Tarjetas";
  if (t.includes("PLATAFORMA")) return "Plataformas";
  if (t.includes("DARK")) return "Dark kitchen";
  if (etiqueta.startsWith("Sin título")) return etiqueta;
  return capitalizar(etiqueta);
}

function naturalezaGasto(etiqueta: string): Naturaleza {
  const t = norm(etiqueta);
  if (t.includes("PRESTAMO")) return "financing";
  if (t.includes("INVERSI")) return "investment";
  return "operating";
}

interface Grupo {
  tipo: "compras" | "personal" | "ingresos" | "gastos";
  colDia: number;
  columnas: { col: number; etiqueta: string; etiqueta2: string }[];
  colTotal: number | null;
}

export function leerAnalitica(hojas: Hoja[], year: number): ResultadoLectura {
  const filas: FilaImportada[] = [];
  const avisos: string[] = [];
  const bloques = new Map<number, BloqueResumen>();

  // títulos de columna vistos en otros meses (para hojas donde falten)
  const titulosConocidos = new Map<string, string>();
  const hojasMes = hojas.filter((h) => MESES.includes(norm(h.nombre)));
  if (hojasMes.length === 0) avisos.push("No se han encontrado hojas mensuales (ENERO…DICIEMBRE).");

  for (const hoja of hojasMes) {
    const mes = MESES.indexOf(norm(hoja.nombre)) + 1;
    const diasMes = new Date(Date.UTC(year, mes, 0)).getUTCDate();
    const fecha = (dia: number) => `${year}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

    // títulos de bloque
    const titulos: { fila: number; texto: string }[] = [];
    for (let f = 1; f <= hoja.filas; f++) {
      for (let c = 1; c <= Math.min(hoja.columnas, 20); c++) {
        const t = texto(hoja.valor(f, c));
        if (/ANALITICA/i.test(t)) { titulos.push({ fila: f, texto: t }); break; }
      }
    }

    titulos.forEach((tit, idx) => {
      const block = idx + 1;
      const finBloque = (titulos[idx + 1]?.fila ?? hoja.filas + 1) - 1;
      const resumen = bloques.get(block) ?? {
        block, titulos: [], sugerido: null, meses: [], totales: { revenue: 0, purchase: 0, labor: 0, expense: 0 }, avisos: [],
      };
      bloques.set(block, resumen);
      resumen.titulos.push(`${capitalizar(hoja.nombre)}: ${tit.texto}`);
      const sug = sugerencia(tit.texto);
      // si el título no coincide con lo esperado por posición, se avisa (p. ej. el 3.º bloque titulado JALEO)
      const esperadoPorPosicion = (["jindama", "jaleo", "juye"] as const)[idx] ?? null;
      if (resumen.sugerido === null) resumen.sugerido = esperadoPorPosicion ?? sug;
      if (sug && esperadoPorPosicion && sug !== esperadoPorPosicion) {
        resumen.avisos.push(`${capitalizar(hoja.nombre)}: el bloque ${block} se titula «${tit.texto}». Comprueba a qué restaurante corresponde.`);
      }

      // fila de cabecera: la primera con «DIA» en las primeras columnas
      let cab = -1;
      for (let f = tit.fila + 1; f <= Math.min(tit.fila + 8, finBloque); f++) {
        for (let c = 1; c <= 4; c++) if (norm(hoja.valor(f, c)) === "DIA") { cab = f; break; }
        if (cab > 0) break;
      }
      if (cab < 0) {
        resumen.avisos.push(`${capitalizar(hoja.nombre)}: no se encuentra la cabecera del bloque ${block}.`);
        return;
      }

      // grupos de columnas que empiezan en «DIA»
      const dias: number[] = [];
      for (let c = 1; c <= hoja.columnas; c++) if (norm(hoja.valor(cab, c)) === "DIA") dias.push(c);
      const grupos: Grupo[] = [];
      dias.forEach((colDia, gi) => {
        const hasta = (dias[gi + 1] ?? hoja.columnas + 1) - 1;
        const columnas: Grupo["columnas"] = [];
        let colTotal: number | null = null;
        for (let c = colDia + 1; c <= hasta; c++) {
          // una cifra en la fila de cabecera no es una etiqueta
          const etq = (v: unknown) => (typeof v === "number" ? "" : texto(v));
          const e1 = etq(hoja.valor(cab, c));
          const e2 = etq(hoja.valor(cab + 1, c));
          const tieneDatos = (() => { for (let f = cab + 2; f <= Math.min(cab + 40, finBloque); f++) { const n = numero(hoja.valor(f, c)); if (n.ok && n.n) return true; } return false; })();
          if (/^TOTAL/i.test(norm(e1)) || /^TOTAL/i.test(norm(e2))) { colTotal ??= c; continue; }
          if (!e1 && !e2 && !tieneDatos) continue;
          columnas.push({ col: c, etiqueta: e1, etiqueta2: e2 });
        }
        // columnas sin título solo cuentan si el grupo tiene títulos o columna TOTAL (si no, son anotaciones)
        const conTitulo = columnas.some((x) => x.etiqueta || x.etiqueta2);
        if (!conTitulo && colTotal === null) return;
        if (columnas.length === 0) return;
        const etiquetas = columnas.map((x) => norm(`${x.etiqueta} ${x.etiqueta2}`)).join(" | ");
        // orden habitual: proveedores, personal, ingresos, gastos (las etiquetas confirman o corrigen)
        let tipo: Grupo["tipo"];
        if (gi === 0) tipo = "compras";
        else if (/NOMBRE|SUELDO/.test(etiquetas)) tipo = "personal";
        else if (/INGRESO|PLATAFORMA|DARK|TARJETA|EFECTIVO/.test(etiquetas)) tipo = "ingresos";
        else if (!grupos.some((x) => x.tipo === "ingresos") && grupos.some((x) => x.tipo === "personal") && !/ALQUILER|LUZ|AGUA|SEGURO|GAS|TPV/.test(etiquetas)) tipo = "ingresos";
        else tipo = "gastos";
        grupos.push({ tipo, colDia, columnas, colTotal });
      });

      let filaTotales = -1;
      for (let f = cab + 1; f <= finBloque; f++) if (/TOTALES/.test(norm(hoja.valor(f, 1)))) { filaTotales = f; break; }
      const ultimaFila = filaTotales > 0 ? filaTotales - 1 : finBloque;
      let algunDato = false;

      const sumas: Record<string, number> = {};
      const sumaCol = new Map<number, number>();
      const diasFuera = new Set<number>();
      for (const g of grupos) {
        if (g.tipo === "personal") {
          // solo totales del mes, sin nombres
          const colNombre = g.columnas.find((x) => /NOMBRE/.test(norm(x.etiqueta2)) || /NOMBRE/.test(norm(x.etiqueta)))?.col;
          const colSueldo = g.columnas.find((x) => /SUELDO/.test(norm(x.etiqueta2)))?.col;
          const colSS = g.columnas.find((x) => /^S\.?S\.?$/.test(norm(x.etiqueta2).replace(/\s/g, "")))?.col;
          if (!colNombre || !colSueldo) continue;
          let sueldos = 0, ss = 0, irpf = 0, n = 0;
          for (let f = cab + 1; f <= ultimaFila; f++) {
            const nombre = norm(hoja.valor(f, colNombre));
            if (!nombre || nombre === "NOMBRE") continue;
            const a = numero(hoja.valor(f, colSueldo));
            const b = colSS ? numero(hoja.valor(f, colSS)) : { ok: true as const, n: null };
            if (!a.ok || !b.ok) {
              filas.push(err(block, hoja.nombre, `${columnaLetra(colSueldo)}${f}`, "Importe de personal no numérico"));
              continue;
            }
            const importe = (a.n ?? 0) + (b.n ?? 0);
            if (nombre.includes("SEGURIDAD SOCIAL")) ss += importe;
            else if (nombre.includes("IRPF")) irpf += importe;
            else { sueldos += importe; n++; }
          }
          const rango = `${columnaLetra(colSueldo)}${cab + 1}:${columnaLetra(colSS ?? colSueldo)}${ultimaFila}`;
          const fin = fecha(diasMes);
          for (const [cat, imp, nota] of [
            ["Sueldos y salarios", sueldos, `suma de ${n} personas`],
            ["Seguridad Social", ss, "fila SEGURIDAD SOCIAL"],
            ["IRPF", irpf, "fila IRPF"],
          ] as const) {
            if (imp === 0) continue;
            algunDato = true;
            filas.push({
              block, sheet: hoja.nombre, cell: rango, original: nota, entry_date: fin, kind: "labor", nature: "operating",
              category: cat, counterparty: null, channel: null, amount: redondear(imp), status: "ok", error: null,
            });
            resumen.totales.labor += imp;
          }
          continue;
        }

        sumas[g.tipo] = 0;
        for (let f = cab + 1; f <= ultimaFila; f++) {
          const d = numero(hoja.valor(f, g.colDia));
          if (!d.ok || d.n === null || !Number.isInteger(d.n) || d.n < 1 || d.n > 31) continue;
          for (const col of g.columnas) {
            const v = hoja.valor(f, col.col);
            const n = numero(v);
            const celda = `${columnaLetra(col.col)}${f}`;
            if (!n.ok) {
              filas.push(err(block, hoja.nombre, celda, `Valor no numérico: «${texto(v)}»`, texto(v)));
              continue;
            }
            if (n.n === null || n.n === 0) continue;
            let dia = d.n;
            let original = texto(v);
            if (d.n > diasMes) {
              // el Excel tiene filas para días que no existen (p. ej. 30 de febrero): se conserva el importe en el último día
              diasFuera.add(d.n);
              dia = diasMes;
              original = `${original} (apuntado en el día ${d.n})`;
            }
            algunDato = true;
            const clave = `${block}:${g.tipo}:${col.col}`;
            if (col.etiqueta || col.etiqueta2) titulosConocidos.set(clave, col.etiqueta || col.etiqueta2);
            const etiqueta = col.etiqueta || col.etiqueta2 || titulosConocidos.get(clave) || `Sin título ${columnaLetra(col.col)}`;
            const base = { block, sheet: hoja.nombre, cell: celda, original, entry_date: fecha(dia), status: "ok" as const, error: null, amount: redondear(n.n) };
            sumaCol.set(col.col, (sumaCol.get(col.col) ?? 0) + n.n);
            if (g.tipo === "compras") {
              filas.push({ ...base, kind: "purchase", nature: "operating", category: "Compras", counterparty: capitalizar(etiqueta), channel: null });
              resumen.totales.purchase += n.n;
            } else if (g.tipo === "ingresos") {
              filas.push({ ...base, kind: "revenue", nature: "operating", category: "Ingresos", counterparty: null, channel: canalIngreso(etiqueta) });
              resumen.totales.revenue += n.n;
            } else {
              const nat = naturalezaGasto(etiqueta);
              filas.push({ ...base, kind: "expense", nature: nat, category: capitalizar(etiqueta), counterparty: null, channel: null });
              if (nat === "operating") resumen.totales.expense += n.n;
            }
            sumas[g.tipo] += n.n;
          }
        }

        // verificación columna a columna contra la fila TOTALES del Excel
        if (filaTotales > 0) {
          for (const col of g.columnas) {
            const t = numero(hoja.valor(filaTotales, col.col));
            const leido = sumaCol.get(col.col) ?? 0;
            if (t.ok && t.n !== null && Math.abs(t.n - leido) > 0.05) {
              resumen.avisos.push(
                `${capitalizar(hoja.nombre)} · ${col.etiqueta || col.etiqueta2 || columnaLetra(col.col)}: las celdas suman ${eur(leido)} pero la fila TOTALES del Excel dice ${eur(t.n)}. Se importa lo que hay en las celdas.`,
              );
            }
          }
        }
      }
      if (diasFuera.size > 0) {
        resumen.avisos.push(
          `${capitalizar(hoja.nombre)}: hay importes en ${[...diasFuera].sort().map((x) => `el día ${x}`).join(" y ")}, que no existe${diasFuera.size > 1 ? "n" : ""}. Se han asignado al ${diasMes}.`,
        );
      }
      if (algunDato && !resumen.meses.includes(capitalizar(hoja.nombre))) resumen.meses.push(capitalizar(hoja.nombre));
    });
  }

  for (const b of bloques.values()) {
    for (const k of Object.keys(b.totales) as Tipo[]) b.totales[k] = redondear(b.totales[k]);
  }
  return { year, filas, bloques: [...bloques.values()].sort((a, b) => a.block - b.block), avisos };
}

function err(block: number, sheet: string, cell: string, error: string, original: string | null = null): FilaImportada {
  return {
    block, sheet, cell, original, entry_date: null, kind: null, nature: null, category: null, counterparty: null, channel: null,
    amount: null, status: "error", error,
  };
}

/** Año del libro: la cabecera de la hoja GENERAL («2026 · TOTAL INGRESOS…») o el del nombre del archivo. */
export function detectarAnio(hojas: Hoja[], nombreArchivo: string): number {
  const m = nombreArchivo.match(/20\d{2}/);
  if (m) return Number(m[0]);
  const general = hojas.find((h) => norm(h.nombre) === "GENERAL");
  if (general) {
    for (let f = 1; f <= Math.min(general.filas, 40); f++) {
      for (let c = 1; c <= Math.min(general.columnas, 20); c++) {
        const v = general.valor(f, c);
        if (typeof v === "number" && v >= 2000 && v <= 2100 && norm(general.valor(f, c + 1)).includes("INGRESOS")) return v;
      }
    }
  }
  return new Date().getFullYear();
}
