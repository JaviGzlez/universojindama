"use client";

export function BotonImprimir() {
  return (
    <button type="button" onClick={() => window.print()} className="h-9 rounded-full bg-tinta px-5 text-[13px] font-medium text-crema hover:bg-grafito">
      Imprimir o guardar PDF
    </button>
  );
}
