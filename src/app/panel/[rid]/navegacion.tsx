"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const SECCIONES: { titulo: string; items: { nombre: string; ruta?: string }[] }[] = [
  {
    titulo: "Restaurante",
    items: [
      { nombre: "Inicio", ruta: "" },
      { nombre: "Escandallo", ruta: "/escandallo" },
    ],
  },
  {
    titulo: "Ajustes de costes",
    items: [
      { nombre: "Materias primas", ruta: "/ingredientes" },
      { nombre: "Equipos", ruta: "/equipos" },
      { nombre: "Personal", ruta: "/personal" },
      { nombre: "Energía e impuestos", ruta: "/ajustes" },
    ],
  },
  {
    titulo: "Próximamente",
    items: [
      { nombre: "Elaboraciones y recetas" },
      { nombre: "Compras y proveedores" },
      { nombre: "Carta y canales" },
      { nombre: "Inventario y mermas" },
      { nombre: "Control económico" },
      { nombre: "Informes y alertas" },
      { nombre: "Asistente IA" },
    ],
  },
];

export function Navegacion({ rid }: { rid: string }) {
  const path = usePathname();
  const [abierto, setAbierto] = useState(false);
  const base = `/panel/${rid}`;

  return (
    <>
      <button
        type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} aria-controls="menu-panel"
        className="mx-4 mb-4 flex h-10 items-center justify-center rounded-xl bg-crema-2 text-[14px] font-medium lg:hidden"
      >
        {abierto ? "Cerrar menú" : "Menú"}
      </button>
      <nav id="menu-panel" aria-label="Panel" className={`${abierto ? "block" : "hidden"} flex-1 overflow-y-auto px-3 pb-6 lg:block`}>
        {SECCIONES.map((s) => (
          <div key={s.titulo} className="mb-5">
            <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-niebla">{s.titulo}</p>
            <ul>
              {s.items.map((it) => {
                if (it.ruta === undefined) {
                  return (
                    <li key={it.nombre}>
                      <span className="flex h-9 items-center justify-between rounded-lg px-3 text-[14px] text-niebla/70" aria-disabled="true">
                        {it.nombre}
                      </span>
                    </li>
                  );
                }
                const href = base + it.ruta;
                const activo = it.ruta === "" ? path === base : path.startsWith(href);
                return (
                  <li key={it.nombre}>
                    <Link
                      href={href} onClick={() => setAbierto(false)} aria-current={activo ? "page" : undefined}
                      className={`flex h-9 items-center rounded-lg px-3 text-[14px] transition ${activo ? "bg-tinta text-crema" : "text-grafito hover:bg-tinta/5"}`}
                    >
                      {it.nombre}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}

const PUNTO: Record<string, string> = { jindama: "bg-musgo", jaleo: "bg-terracota", "juye-burger": "bg-ambar" };

export function SelectorRestaurante({ actual, restaurantes }: { actual: string; restaurantes: { id: string; name: string; slug: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const actualR = restaurantes.find((r) => r.id === actual);
  return (
    <label className="block">
      <span className="sr-only">Restaurante</span>
      <span className="relative flex items-center">
        <span className={`pointer-events-none absolute left-3.5 h-2.5 w-2.5 rounded-full ${PUNTO[actualR?.slug ?? ""] ?? "bg-grafito"}`} />
        <select
          value={actual}
          onChange={(e) => {
            const nuevo = e.target.value;
            document.cookie = `uj_restaurante=${nuevo}; path=/; max-age=31536000; samesite=lax`;
            router.push(path.replace(`/panel/${actual}`, `/panel/${nuevo}`));
          }}
          className="select-chevron h-11 w-full appearance-none rounded-xl border border-linea bg-white pl-9 pr-9 text-[15px] font-medium outline-none focus:border-musgo focus:ring-4 focus:ring-musgo/15"
        >
          {restaurantes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </span>
    </label>
  );
}
