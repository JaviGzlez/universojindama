"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";

export interface ResultadoAccion {
  ok: boolean;
  mensaje: string;
  errores?: Record<string, string>;
  t?: number;
}

const INICIAL: ResultadoAccion = { ok: false, mensaje: "" };

/**
 * Formulario ligado a una server action. Solo muestra «Guardado» cuando el
 * servidor confirma la escritura; nunca presenta un cambio local como guardado.
 */
export function FormularioAccion({
  action, children, boton = "Guardar", limpiar = true, className = "",
}: {
  action: (prev: ResultadoAccion, form: FormData) => Promise<ResultadoAccion>;
  children: ReactNode;
  boton?: string;
  limpiar?: boolean;
  className?: string;
}) {
  const [estado, accion, pendiente] = useActionState(action, INICIAL);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.ok && limpiar) ref.current?.reset();
  }, [estado, limpiar]);

  return (
    <form ref={ref} action={accion} className={className}>
      {children}
      {estado.errores && Object.keys(estado.errores).length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl bg-terracota-claro px-4 py-3 text-[13px] text-error">
          {Object.entries(estado.errores).map(([k, v]) => <li key={k}>{v}</li>)}
        </ul>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="submit" disabled={pendiente}
          className="h-10 rounded-full bg-tinta px-5 text-[14px] font-medium text-crema transition hover:bg-grafito disabled:opacity-60"
        >
          {pendiente ? "Guardando…" : boton}
        </button>
        <p aria-live="polite" className={`text-[13px] ${estado.ok ? "text-musgo" : "text-error"}`}>
          {!pendiente && estado.mensaje && (estado.ok ? `✓ ${estado.mensaje}` : estado.mensaje)}
        </p>
      </div>
    </form>
  );
}

/** Botón pequeño ligado a una server action (p. ej. archivar). */
export function AccionRapida({
  action, campos, etiqueta, confirmar,
}: {
  action: (prev: ResultadoAccion, form: FormData) => Promise<ResultadoAccion>;
  campos: Record<string, string | number>;
  etiqueta: string;
  confirmar?: string;
}) {
  const [estado, accion, pendiente] = useActionState(action, INICIAL);
  return (
    <form
      action={accion}
      onSubmit={(e) => { if (confirmar && !window.confirm(confirmar)) e.preventDefault(); }}
      className="inline-flex items-center gap-2"
    >
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pendiente} className="text-[13px] font-medium text-niebla hover:text-tinta disabled:opacity-50">
        {pendiente ? "…" : etiqueta}
      </button>
      {!estado.ok && estado.mensaje && <span className="text-[12px] text-error">{estado.mensaje}</span>}
    </form>
  );
}
