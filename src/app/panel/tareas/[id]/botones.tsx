"use client";

import { useState, useTransition } from "react";
import { ESTADOS, NOMBRE_ESTADO, type Estado } from "@/lib/tareas";
import { cambiarTarea } from "../actions";

/** Acciones rápidas en el detalle: quedársela, soltarla y mover de estado. */
export function BotonesEstado({ id, estado, libre, mia, gestiona }: { id: string; estado: Estado; libre: boolean; mia: boolean; gestiona: boolean }) {
  const [pendiente, start] = useTransition();
  const [error, setError] = useState("");
  const run = (c: Parameters<typeof cambiarTarea>[1]) => start(async () => {
    setError("");
    const r = await cambiarTarea(id, c);
    if (!r.ok) setError(r.mensaje);
  });
  const boton = "h-10 rounded-full px-5 text-[14px] font-medium transition disabled:opacity-50";

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2">
        {libre && estado !== "done" && (
          <button type="button" disabled={pendiente} onClick={() => run({ asignarme: true, status: estado === "pending" ? "in_progress" : undefined })}
            className={`${boton} bg-tinta text-crema hover:bg-grafito`}>Me la quedo</button>
        )}
        {!libre && !mia && estado !== "done" && (
          <button type="button" disabled={pendiente} onClick={() => run({ asignarme: true })}
            className={`${boton} bg-tinta text-crema hover:bg-grafito`}>Me apunto</button>
        )}
        {gestiona && ESTADOS.filter((e) => e !== estado).map((e) => (
          <button key={e} type="button" disabled={pendiente} onClick={() => run({ status: e })}
            className={`${boton} ${e === "done" ? "bg-musgo text-white hover:opacity-90" : "bg-white text-tinta ring-1 ring-linea hover:bg-crema-2"}`}>
            {e === "done" ? "✓ Marcar completada" : `Pasar a ${NOMBRE_ESTADO[e].toLowerCase()}`}
          </button>
        ))}
        {mia && estado !== "done" && (
          <button type="button" disabled={pendiente} onClick={() => run({ soltar: true })}
            className={`${boton} text-grafito hover:bg-crema-2`}>Dejar de ser responsable</button>
        )}
      </div>
      <p aria-live="polite" className="mt-2 text-[13px] text-error">{error}</p>
    </div>
  );
}
