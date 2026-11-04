"use client";

import { useActionState } from "react";
import { acceder, type EstadoAcceso } from "./actions";

export function FormularioAcceso({ next, errorInicial }: { next?: string; errorInicial?: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoAcceso, FormData>(acceder, { error: errorInicial });

  return (
    <form action={accion} className="mt-10 space-y-3" noValidate>
      <input type="hidden" name="modo" value="entrar" />
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-grafito">Correo electrónico</span>
        <input
          name="email" type="email" autoComplete="email" required
          className="h-12 w-full rounded-xl border border-linea bg-white px-4 text-[16px] outline-none transition focus:border-musgo focus:ring-4 focus:ring-musgo/15"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-grafito">Contraseña</span>
        <input
          name="password" type="password" required minLength={8}
          autoComplete="current-password"
          className="h-12 w-full rounded-xl border border-linea bg-white px-4 text-[16px] outline-none transition focus:border-musgo focus:ring-4 focus:ring-musgo/15"
        />
      </label>

      <div aria-live="polite" className="min-h-6 pt-1 text-[14px]">
        {estado.error && <p className="text-error">{estado.error}</p>}
        {estado.aviso && <p className="text-musgo">{estado.aviso}</p>}
      </div>

      <button
        type="submit" disabled={pendiente}
        className="h-12 w-full rounded-full bg-tinta text-[16px] font-medium text-crema transition hover:bg-grafito disabled:opacity-60"
      >
        {pendiente ? "Un momento…" : "Entrar"}
      </button>
      <p className="pt-6 text-center text-[12px] leading-relaxed text-niebla">
        ¿No tienes cuenta o has olvidado la contraseña? Pídesela al administrador del grupo.
      </p>
    </form>
  );
}
