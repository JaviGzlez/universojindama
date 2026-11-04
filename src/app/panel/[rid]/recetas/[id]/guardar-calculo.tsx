"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { guardarCalculo } from "../actions";

export function BotonGuardarCalculo({ rid, recipeId }: { rid: string; recipeId: string }) {
  const router = useRouter();
  const [pendiente, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; mensaje: string } | null>(null);
  return (
    <div className="flex items-center gap-3">
      {msg && <span aria-live="polite" className={`text-[13px] ${msg.ok ? "text-musgo" : "text-error"}`}>{msg.mensaje}</span>}
      <button type="button" disabled={pendiente}
        onClick={() => start(async () => { const r = await guardarCalculo(rid, recipeId); setMsg(r); if (r.ok) router.refresh(); })}
        className="h-9 rounded-full bg-white px-4 text-[13px] font-medium ring-1 ring-linea hover:bg-crema-2 disabled:opacity-60">
        {pendiente ? "Calculando…" : "Recalcular y guardar ahora"}
      </button>
    </div>
  );
}
