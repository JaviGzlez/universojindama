"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const SECCIONES: { titulo: string; items: { nombre: string; ruta?: string; exacta?: boolean }[] }[] = [
  {
    titulo: "Restaurante",
    items: [
      { nombre: "Inicio", ruta: "", exacta: true },
      { nombre: "Actividad", ruta: "/actividad" },
    ],
  },
  {
    titulo: "Cocina",
    items: [
      { nombre: "Recetas y elaboraciones", ruta: "/recetas" },
      { nombre: "Escandallo rápido", ruta: "/escandallo" },
      { nombre: "Materias primas", ruta: "/ingredientes" },
      { nombre: "Equipos y consumibles", ruta: "/equipos" },
    ],
  },
  {
    titulo: "Compras y almacén",
    items: [
      { nombre: "Facturas", ruta: "/compras", exacta: true },
      { nombre: "Proveedores", ruta: "/compras/proveedores" },
      { nombre: "Inventario y mermas", ruta: "/inventario" },
    ],
  },
  {
    titulo: "Sala y ventas",
    items: [
      { nombre: "Carta y canales", ruta: "/carta" },
      { nombre: "Ventas", ruta: "/ventas" },
    ],
  },
  {
    titulo: "Economía",
    items: [
      { nombre: "Resultados", ruta: "/economia", exacta: true },
      { nombre: "Movimientos", ruta: "/economia/movimientos" },
      { nombre: "Importar Excel", ruta: "/economia/importar" },
    ],
  },
  {
    titulo: "Ajustes",
    items: [
      { nombre: "Personal", ruta: "/personal" },
      { nombre: "Energía, impuestos y objetivos", ruta: "/ajustes" },
      { nombre: "Usuarios", ruta: "/usuarios" },
    ],
  },
  {
    titulo: "Próximamente",
    items: [{ nombre: "Asistente IA" }],
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
        <Link href="/panel" className="mb-4 flex h-9 items-center gap-2 rounded-lg px-3 text-[14px] font-medium text-grafito hover:bg-tinta/5">
          <span aria-hidden="true">←</span> Universo
        </Link>
        {SECCIONES.map((s) => (
          <div key={s.titulo} className="mb-4">
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-niebla">{s.titulo}</p>
            <ul>
              {s.items.map((it) => {
                if (it.ruta === undefined) {
                  return (
                    <li key={it.nombre}>
                      <span className="flex h-8 items-center rounded-lg px-3 text-[14px] text-niebla/70" aria-disabled="true">{it.nombre}</span>
                    </li>
                  );
                }
                const href = base + it.ruta;
                const activo = it.exacta ? path === href : path === href || path.startsWith(`${href}/`);
                return (
                  <li key={it.nombre}>
                    <Link
                      href={href} onClick={() => setAbierto(false)} aria-current={activo ? "page" : undefined}
                      className={`flex h-8 items-center rounded-lg px-3 text-[14px] transition ${activo ? "bg-tinta text-crema" : "text-grafito hover:bg-tinta/5"}`}
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
            // las páginas de detalle (una receta, una factura) son de un restaurante: se vuelve al listado
            const resto = path.replace(`/panel/${actual}`, "").split("/").slice(0, 2).join("/");
            router.push(`/panel/${nuevo}${resto === "/compras" && path.includes("/proveedores") ? "/compras/proveedores" : resto}`);
          }}
          className="select-chevron h-11 w-full appearance-none rounded-xl border border-linea bg-white pl-9 pr-9 text-[15px] font-medium outline-none focus:border-musgo focus:ring-4 focus:ring-musgo/15"
        >
          {restaurantes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </span>
    </label>
  );
}
