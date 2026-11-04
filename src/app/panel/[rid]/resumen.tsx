"use client";

import { useState } from "react";
import { Cifra, GraficoMensual } from "@/components/graficos";

interface Mes { mes: string; ingresos: number; compras: number; personal: number; gastos: number; resultado: number; conDatos: boolean }

const METRICAS = [
  ["ingresos", "Ingresos"],
  ["resultado", "Resultado"],
  ["compras", "Compras"],
  ["personal", "Personal"],
  ["gastos", "Gastos"],
] as const;

export function ResumenRestaurante({ meses, color }: { meses: Mes[]; color: string }) {
  const [m, setM] = useState<(typeof METRICAS)[number][0]>("ingresos");
  const hay = meses.some((x) => x.conDatos);
  const total = (k: keyof Mes) => meses.reduce((a, x) => a + (x[k] as number), 0);
  const ingresos = total("ingresos");
  const resultado = total("resultado");
  return (
    <section className="rounded-[22px] bg-white p-5 ring-1 ring-linea md:p-7" aria-labelledby="res-t">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="res-t" className="text-[19px] font-semibold tracking-[-0.01em]">Este año</h2>
          <p className="mt-1 text-[13px] text-niebla">
            Ingresos <Cifra valor={hay ? ingresos : null} className="font-medium text-tinta" /> · Resultado operativo{" "}
            <Cifra valor={hay ? resultado : null} className={`font-medium ${resultado < 0 ? "text-terracota" : "text-tinta"}`} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Métrica">
          {METRICAS.map(([id, nombre]) => (
            <button key={id} type="button" onClick={() => setM(id)} aria-pressed={m === id}
              className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition ${m === id ? "bg-tinta text-crema" : "bg-crema-2 text-grafito hover:bg-linea"}`}>
              {nombre}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <GraficoMensual
          puntos={meses.map((x) => ({ mes: x.mes, valor: x.conDatos ? x[m] : null }))}
          color={color}
          etiqueta={METRICAS.find((x) => x[0] === m)![1]}
          alto={220}
        />
      </div>
    </section>
  );
}
