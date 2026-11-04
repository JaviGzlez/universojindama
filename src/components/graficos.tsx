"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/** Paleta categórica validada (CVD y visión normal) sobre fondo claro. Orden fijo. */
export const COLOR_SERIE = { jindama: "#2f8a5f", juye: "#4a68d1", jaleo: "#cf6a33", grupo: "#1d1d1f" } as const;

const euros = (v: number, compacto = false) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency", currency: "EUR",
    notation: compacto ? "compact" : "standard",
    maximumFractionDigits: compacto ? 1 : 0,
  }).format(v);

const mesCorto = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { month: "short", timeZone: "UTC" }).replace(".", "");

export interface Punto { mes: string; valor: number | null }

/** Número que cuenta hasta su valor al cambiar. */
export function Cifra({ valor, formato = "euro", className = "" }: { valor: number | null; formato?: "euro" | "pct"; className?: string }) {
  const [mostrado, setMostrado] = useState(valor ?? 0);
  const desde = useRef(valor ?? 0);
  useEffect(() => {
    if (valor === null) return;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducido) { setMostrado(valor); desde.current = valor; return; }
    const ini = desde.current;
    const t0 = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      setMostrado(ini + (valor - ini) * e);
      if (k < 1) raf = requestAnimationFrame(paso);
      else desde.current = valor;
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  if (valor === null) return <span className={className}>—</span>;
  const txt = formato === "pct"
    ? `${mostrado.toLocaleString("es-ES", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`
    : euros(mostrado);
  return <span className={`tabular-nums ${className}`}>{txt}</span>;
}

/**
 * Área + línea mensual con trazo animado al cambiar de serie y cruz con
 * tooltip al pasar el ratón o el dedo. Valores negativos permitidos (resultado).
 */
export function GraficoMensual({ puntos, color, etiqueta, alto = 260 }: { puntos: Punto[]; color: string; etiqueta: string; alto?: number }) {
  const id = useId().replace(/:/g, "");
  // el ancho real del contenedor: así los textos mantienen su tamaño en móvil
  const cajaRef = useRef<HTMLElement>(null);
  const [ancho, setAncho] = useState(720);
  useEffect(() => {
    const el = cajaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const m = { t: 16, r: 16, b: 28, l: 56 };
  const w = ancho - m.l - m.r;
  const h = alto - m.t - m.b;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { escalaY, ticks, camino, area, xs, cero } = useMemo(() => {
    const vals = puntos.map((p) => p.valor).filter((v): v is number => v !== null);
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const rango = max - min || 1;
    const paso = Math.pow(10, Math.floor(Math.log10(rango / 4)));
    const salto = [1, 2, 2.5, 5, 10].map((x) => x * paso).find((x) => rango / x <= 5) ?? paso * 10;
    const top = Math.ceil(max / salto) * salto || salto;
    const bot = Math.floor(min / salto) * salto;
    const y = (v: number) => m.t + h - ((v - bot) / (top - bot)) * h;
    const ts: number[] = [];
    for (let v = bot; v <= top + 1e-9; v += salto) ts.push(v);
    const xs = puntos.map((_, i) => m.l + (puntos.length === 1 ? w / 2 : (i * w) / (puntos.length - 1)));
    let c = "";
    let a = "";
    puntos.forEach((p, i) => {
      if (p.valor === null) return;
      const cmd = c === "" ? "M" : "L";
      c += `${cmd}${xs[i].toFixed(1)},${y(p.valor).toFixed(1)} `;
    });
    const validos = puntos.map((p, i) => ({ p, i })).filter((x) => x.p.valor !== null);
    if (validos.length > 1) {
      a = `M${xs[validos[0].i]},${y(0)} ` + validos.map(({ p, i }) => `L${xs[i].toFixed(1)},${y(p.valor!).toFixed(1)}`).join(" ") + ` L${xs[validos[validos.length - 1].i]},${y(0)} Z`;
    }
    return { escalaY: y, ticks: ts, camino: c, area: a, xs, cero: y(0) };
  }, [puntos, h, w, m.l, m.t]);
  const pocoSitio = ancho < 520;

  const hayDatos = puntos.some((p) => p.valor !== null && p.valor !== 0);
  const clave = `${etiqueta}-${color}-${puntos.map((p) => p.valor).join(",")}`;

  const mover = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * ancho;
    let mejor = 0;
    xs.forEach((xx, i) => { if (Math.abs(xx - x) < Math.abs(xs[mejor] - x)) mejor = i; });
    setHover(mejor);
  };

  return (
    <figure ref={cajaRef} className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${ancho} ${alto}`}
        className="h-auto w-full touch-pan-y select-none"
        role="img"
        aria-label={`${etiqueta} por mes`}
        onMouseMove={(e) => mover(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => mover(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={ancho - m.r} y1={escalaY(t)} y2={escalaY(t)} stroke="#e6e0d6" strokeWidth={t === 0 ? 1.2 : 1} strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={m.l - 10} y={escalaY(t)} dy="0.35em" textAnchor="end" className="fill-niebla text-[11px]">{euros(t, true)}</text>
          </g>
        ))}
        {puntos.map((p, i) => (pocoSitio && i % 2 === 1 && i !== hover) ? null : (
          <text key={p.mes} x={xs[i]} y={alto - 8} textAnchor="middle" className={`text-[11px] ${hover === i ? "fill-tinta" : "fill-niebla"}`}>{mesCorto(p.mes)}</text>
        ))}
        {hayDatos && (
          <g key={clave}>
            <path d={area} fill={`url(#g${id})`} className="grafico-aparecer" />
            <path d={camino} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="grafico-trazo" />
            {puntos.map((p, i) => p.valor !== null && (
              <circle key={i} cx={xs[i]} cy={escalaY(p.valor)} r={hover === i ? 5 : 3} fill="#fff" stroke={color} strokeWidth={2} className="grafico-aparecer" />
            ))}
          </g>
        )}
        {hover !== null && <line x1={xs[hover]} x2={xs[hover]} y1={m.t} y2={cero > m.t + h ? m.t + h : m.t + h} stroke="#1d1d1f" strokeOpacity="0.15" />}
        {!hayDatos && (
          <text x={ancho / 2} y={alto / 2} textAnchor="middle" className="fill-niebla text-[13px]">Sin datos en este periodo</text>
        )}
      </svg>
      {hover !== null && hayDatos && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-xl bg-tinta px-3 py-2 text-[12px] text-crema shadow-lg"
          style={{ left: `${(xs[hover] / ancho) * 100}%` }}
        >
          <p className="text-crema/60 first-letter:uppercase">{new Date(puntos[hover].mes).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
          <p className="font-semibold tabular-nums">{puntos[hover].valor === null ? "Sin datos" : euros(puntos[hover].valor!)}</p>
        </div>
      )}
      <figcaption className="sr-only">
        {etiqueta}: {puntos.map((p) => `${mesCorto(p.mes)} ${p.valor === null ? "sin datos" : euros(p.valor)}`).join("; ")}
      </figcaption>
    </figure>
  );
}

/** Barras horizontales comparando restaurantes, con etiqueta directa. */
export function BarrasComparadas({ filas, formato = "euro" }: { filas: { nombre: string; valor: number | null; color: string }[]; formato?: "euro" | "pct" }) {
  const max = Math.max(1, ...filas.map((f) => Math.abs(f.valor ?? 0)));
  return (
    <ul className="space-y-4">
      {filas.map((f) => (
        <li key={f.nombre}>
          <div className="mb-1.5 flex items-baseline justify-between text-[14px]">
            <span className="flex items-center gap-2 font-medium">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: f.color }} aria-hidden="true" />
              {f.nombre}
            </span>
            <Cifra valor={f.valor} formato={formato} className="text-grafito" />
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-crema-2">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${(Math.abs(f.valor ?? 0) / max) * 100}%`, background: f.color, opacity: (f.valor ?? 0) < 0 ? 0.5 : 1 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
