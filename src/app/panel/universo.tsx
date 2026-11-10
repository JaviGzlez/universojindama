"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BarrasComparadas, Cifra, COLOR_SERIE, GraficoMensual, type Punto } from "@/components/graficos";
import { Mundo, type MundoId } from "@/components/mundo";

export interface MesDatos {
  mes: string;
  ingresos: number;
  compras: number;
  personal: number;
  gastos: number;
  financiacion: number;
  resultado: number;
  conDatos: boolean;
}

export interface RestauranteUniverso {
  id: string;
  nombre: string;
  mundo: MundoId;
  meses: MesDatos[];
  recetas: number;
  avisos: number;
}

const METRICAS = [
  { id: "ingresos", nombre: "Ingresos" },
  { id: "resultado", nombre: "Resultado" },
  { id: "compras", nombre: "Compras" },
  { id: "personal", nombre: "Personal" },
  { id: "gastos", nombre: "Gastos" },
] as const;
type Metrica = (typeof METRICAS)[number]["id"];

const POS: Record<MundoId, string> = {
  jindama: "left-[6%] top-[22%] sm:left-[12%]",
  jaleo: "right-[6%] top-[10%] sm:right-[14%]",
  juye: "bottom-[4%] left-[54%] sm:bottom-[0%] sm:left-[57%]",
};
const TAM: Record<MundoId, string> = {
  jindama: "h-[96px] w-[96px] sm:h-[150px] sm:w-[150px]",
  jaleo: "h-[84px] w-[84px] sm:h-[128px] sm:w-[128px]",
  juye: "h-[76px] w-[76px] sm:h-[112px] sm:w-[112px]",
};
const FLOTA: Record<MundoId, string> = { jindama: "flotar-a", jaleo: "flotar-b", juye: "flotar-c" };

export function Universo({ restaurantes, anio }: { restaurantes: RestauranteUniverso[]; anio: number }) {
  const router = useRouter();
  const [sel, setSel] = useState<string>("grupo");
  const entrar = (id: string) => {
    document.cookie = `uj_restaurante=${id}; path=/; max-age=31536000; samesite=lax`;
    router.push(`/panel/${id}`);
  };
  const [metrica, setMetrica] = useState<Metrica>("ingresos");

  const elegido = restaurantes.find((r) => r.id === sel);
  const color = elegido ? COLOR_SERIE[elegido.mundo] : COLOR_SERIE.grupo;
  const conjunto = useMemo(() => (elegido ? [elegido] : restaurantes), [elegido, restaurantes]);

  const puntos: Punto[] = useMemo(() => (restaurantes[0]?.meses ?? []).map((m, i) => {
    const filas = conjunto.map((r) => r.meses[i]);
    const hay = filas.some((f) => f.conDatos);
    return { mes: m.mes, valor: hay ? filas.reduce((a, f) => a + f[metrica], 0) : null };
  }), [conjunto, restaurantes, metrica]);

  const total = (r: RestauranteUniverso[], k: keyof MesDatos) => r.reduce((a, x) => a + x.meses.reduce((b, m) => b + (m[k] as number), 0), 0);
  const ingresos = total(conjunto, "ingresos");
  const resultado = total(conjunto, "resultado");
  const compras = total(conjunto, "compras");
  const personal = total(conjunto, "personal");
  const hayDatos = conjunto.some((r) => r.meses.some((m) => m.conDatos));
  const pct = (v: number) => (ingresos > 0 ? (v / ingresos) * 100 : null);
  const nombreMetrica = METRICAS.find((m) => m.id === metrica)!.nombre;

  return (
    <>
      {/* -------------------------------------------------------- universo */}
      <section className="orbita-pausa relative mx-auto h-[340px] max-w-4xl sm:h-[440px]" aria-label="Elige restaurante">
        <div className="absolute left-1/2 top-1/2 h-[250px] w-[94%] -translate-x-1/2 -translate-y-1/2 sm:h-[330px]" aria-hidden="true">
          <div className="girar-lento absolute inset-0 rounded-[50%] border border-tinta/10" />
          <div className="girar-lento-inverso absolute inset-[16%] rounded-[50%] border border-dashed border-tinta/10" />
        </div>
        <button
          type="button" onClick={() => setSel("grupo")} aria-pressed={sel === "grupo"}
          className={`absolute left-1/2 top-1/2 z-10 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-white text-[11px] font-medium shadow-[0_20px_50px_-20px_rgba(40,30,20,0.35)] ring-1 transition sm:h-24 sm:w-24 ${sel === "grupo" ? "ring-2 ring-tinta" : "ring-linea hover:ring-tinta/40"}`}
        >
          <span className="mb-1 h-2.5 w-2.5 rounded-full bg-tinta" aria-hidden="true" />
          Grupo
        </button>
        {restaurantes.map((r) => (
          <button
            key={r.id} type="button" onClick={() => setSel(r.id)} onDoubleClick={() => entrar(r.id)} aria-pressed={sel === r.id}
            title={`Clic: ver cifras de ${r.nombre} · Doble clic: entrar`}
            className={`group absolute z-10 flex flex-col items-center gap-2 ${POS[r.mundo]} ${FLOTA[r.mundo]}`}
          >
            <span className={`block rounded-full transition duration-500 ${sel === r.id ? "scale-110 ring-4 ring-offset-4 ring-offset-crema" : sel === "grupo" ? "" : "opacity-60 saturate-50 group-hover:opacity-100 group-hover:saturate-100"}`}
              style={sel === r.id ? { ["--tw-ring-color" as string]: COLOR_SERIE[r.mundo] } : undefined}>
              <Mundo id={r.mundo} className={TAM[r.mundo]} />
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-medium transition ${sel === r.id ? "bg-tinta text-crema" : "bg-white/80 text-grafito backdrop-blur"}`}>
              {r.nombre}
            </span>
          </button>
        ))}
      </section>

      {/* --------------------------------------------------------- métricas */}
      <section className="mt-6" aria-labelledby="graf-t">
        <div className="flex flex-col items-center gap-5">
          <h2 id="graf-t" className="text-center text-[28px] font-semibold tracking-[-0.03em] md:text-[36px]">
            {nombreMetrica} <span className="font-serif font-normal italic">{elegido ? `en ${elegido.nombre}` : "del grupo"}</span>
            <span className="ml-2 text-[15px] font-normal text-niebla">{anio}</span>
          </h2>
          {elegido && (
            <button type="button" onClick={() => entrar(elegido.id)} className="-mt-2 h-9 rounded-full bg-tinta px-5 text-[13px] font-medium text-crema hover:bg-grafito">
              Entrar en {elegido.nombre} →
            </button>
          )}
          <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Métrica">
            {METRICAS.map((m) => (
              <button
                key={m.id} type="button" onClick={() => setMetrica(m.id)} aria-pressed={metrica === m.id}
                className={`h-9 rounded-full px-4 text-[13px] font-medium transition ${metrica === m.id ? "bg-tinta text-crema" : "bg-white text-grafito ring-1 ring-linea hover:bg-crema-2"}`}
              >
                {m.nombre}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-[28px] bg-white p-4 ring-1 ring-linea sm:p-8">
          <GraficoMensual puntos={puntos} color={color} etiqueta={`${nombreMetrica}${elegido ? ` · ${elegido.nombre}` : " · grupo"}`} />
          {!hayDatos && (
            <p className="mt-2 text-center text-[13px] text-niebla">
              Importa el Excel de analítica o registra movimientos en Economía para ver la evolución.
            </p>
          )}
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi titulo={`Ingresos ${anio}`}><Cifra valor={hayDatos ? ingresos : null} /></Kpi>
          <Kpi titulo="Resultado operativo" nota={pct(resultado) !== null ? `${pct(resultado)!.toFixed(1).replace(".", ",")} % sobre ingresos` : undefined}>
            <Cifra valor={hayDatos ? resultado : null} className={resultado < 0 ? "text-terracota" : ""} />
          </Kpi>
          <Kpi titulo="Compras sobre ingresos"><Cifra valor={hayDatos ? pct(compras) : null} formato="pct" /></Kpi>
          <Kpi titulo="Personal sobre ingresos"><Cifra valor={hayDatos ? pct(personal) : null} formato="pct" /></Kpi>
        </dl>
        <p className="mt-3 text-center text-[12px] text-niebla">
          Importes registrados (Excel o manuales). Préstamos e inversiones quedan fuera del resultado operativo. No es un resultado contable cerrado.
        </p>
      </section>

      {/* ------------------------------------------------------ comparativa */}
      {!elegido && restaurantes.length > 1 && (
        <section className="mt-12 rounded-[28px] bg-white p-6 ring-1 ring-linea sm:p-8" aria-labelledby="comp-t">
          <h2 id="comp-t" className="mb-6 text-[19px] font-semibold tracking-[-0.01em]">{nombreMetrica} por restaurante · {anio}</h2>
          <BarrasComparadas
            filas={[...restaurantes]
              .sort((a, b) => ORDEN[a.mundo] - ORDEN[b.mundo])
              .map((r) => ({ nombre: r.nombre, color: COLOR_SERIE[r.mundo], valor: r.meses.some((m) => m.conDatos) ? total([r], metrica) : null }))}
          />
        </section>
      )}

      {/* ---------------------------------------------------------- accesos */}
      <section className="mt-12" aria-labelledby="ent-t">
        <h2 id="ent-t" className="sr-only">Entrar en cada restaurante</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {restaurantes.map((r) => (
            <li key={r.id}>
              <Link
                href={`/panel/${r.id}`}
                onClick={() => { document.cookie = `uj_restaurante=${r.id}; path=/; max-age=31536000; samesite=lax`; }}
                className={`group flex items-center gap-5 rounded-[24px] bg-white p-5 ring-1 transition hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-30px_rgba(40,30,20,0.45)] ${sel === r.id ? "ring-2 ring-tinta" : "ring-linea"}`}
              >
                <Mundo id={r.mundo} size={64} />
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] font-semibold tracking-[-0.01em]">{r.nombre}</p>
                  <p className="text-[13px] text-niebla">
                    {r.recetas} {r.recetas === 1 ? "receta" : "recetas"}
                    {r.avisos > 0 && <span className="text-terracota"> · {r.avisos} {r.avisos === 1 ? "aviso" : "avisos"}</span>}
                  </p>
                </div>
                <span className="text-[20px] text-niebla transition group-hover:translate-x-1 group-hover:text-tinta" aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const ORDEN: Record<MundoId, number> = { jindama: 0, juye: 1, jaleo: 2 };

function Kpi({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] bg-white p-5 ring-1 ring-linea">
      <dt className="text-[13px] text-niebla">{titulo}</dt>
      <dd className="mt-1.5 text-[24px] font-semibold tracking-[-0.02em] sm:text-[28px]">{children}</dd>
      {nota && <p className="mt-0.5 text-[12px] text-niebla">{nota}</p>}
    </div>
  );
}
