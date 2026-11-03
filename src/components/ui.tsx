import type { ReactNode } from "react";

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[22px] bg-white p-6 ring-1 ring-linea md:p-7 ${className}`}>{children}</section>;
}

export function Cabecera({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.03em] md:text-[40px]">{titulo}</h1>
        {subtitulo && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-niebla">{subtitulo}</p>}
      </div>
      {children}
    </div>
  );
}

const INPUT =
  "h-11 w-full rounded-xl border border-linea bg-white px-3.5 text-[15px] outline-none transition placeholder:text-niebla/60 focus:border-musgo focus:ring-4 focus:ring-musgo/15 disabled:bg-crema-2";

export function Campo({
  label, name, unidad, ayuda, className = "", ...props
}: { label: string; name: string; unidad?: string; ayuda?: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-grafito">{label}</span>
      <span className="relative block">
        <input name={name} className={`${INPUT} ${unidad ? "pr-14" : ""}`} {...props} />
        {unidad && (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[13px] text-niebla">{unidad}</span>
        )}
      </span>
      {ayuda && <span className="mt-1 block text-[12px] leading-snug text-niebla">{ayuda}</span>}
    </label>
  );
}

export function Selector({
  label, name, children, ayuda, className = "", ...props
}: { label: string; name: string; children: ReactNode; ayuda?: string; className?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-grafito">{label}</span>
      <select name={name} className={`${INPUT} select-chevron appearance-none pr-9`} {...props}>
        {children}
      </select>
      {ayuda && <span className="mt-1 block text-[12px] leading-snug text-niebla">{ayuda}</span>}
    </label>
  );
}

export const claseInput = INPUT;

export function Insignia({ tono = "neutro", children }: { tono?: "neutro" | "ok" | "estimado" | "pendiente"; children: ReactNode }) {
  const t = {
    neutro: "bg-crema-2 text-grafito",
    ok: "bg-musgo-claro text-musgo",
    estimado: "bg-ambar-claro text-ambar",
    pendiente: "bg-terracota-claro text-terracota",
  }[tono];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${t}`}>{children}</span>;
}

export function Vacio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-linea px-6 py-14 text-center">
      <p className="text-[17px] font-semibold">{titulo}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-niebla">{texto}</p>
    </div>
  );
}

export function Tabla({ cabeceras, children }: { cabeceras: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[22px] bg-white ring-1 ring-linea">
      <table className="w-full min-w-[640px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-linea text-[12px] uppercase tracking-[0.06em] text-niebla">
            {cabeceras.map((c) => (
              <th key={c} scope="col" className="px-5 py-3.5 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-linea/70">{children}</tbody>
      </table>
    </div>
  );
}

export const euro = (v: string | number | null | undefined, decimales = 2) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);
};

export const numero = (v: string | number | null | undefined, max = 2) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: max }).format(n);
};
