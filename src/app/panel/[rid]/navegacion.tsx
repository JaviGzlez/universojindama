"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type Area = "recetas" | "materias" | "equipos" | "compras" | "inventario" | "carta" | "ventas" | "economia" | "personal" | "ajustes";
interface Item { nombre: string; ruta?: string; exacta?: boolean; area?: Area | Area[]; href?: string }

const SECCIONES: { titulo: string; items: Item[]; soloPropietario?: boolean; neutra?: boolean }[] = [
  { titulo: "Restaurante", items: [{ nombre: "Inicio", ruta: "", exacta: true }, { nombre: "Tareas del equipo", href: "/panel/tareas?r=:rid" }] },
  {
    titulo: "Cocina",
    items: [
      { nombre: "Platos", ruta: "/recetas", area: "recetas" },
      { nombre: "Elaboraciones", ruta: "/elaboraciones", area: "recetas" },
      { nombre: "Escandallo rápido", ruta: "/escandallo", area: ["recetas", "materias"] },
      { nombre: "Materias primas", ruta: "/ingredientes", area: "materias" },
      { nombre: "Equipos y consumibles", ruta: "/equipos", area: "equipos" },
    ],
  },
  {
    titulo: "Compras y almacén",
    items: [
      { nombre: "Facturas", ruta: "/compras", exacta: true, area: "compras" },
      { nombre: "Proveedores", ruta: "/compras/proveedores", area: "compras" },
      { nombre: "Inventario y mermas", ruta: "/inventario", area: "inventario" },
    ],
  },
  {
    titulo: "Sala y ventas",
    items: [
      { nombre: "Carta y canales", ruta: "/carta", area: "carta" },
      { nombre: "Ventas", ruta: "/ventas", area: "ventas" },
    ],
  },
  {
    titulo: "Economía",
    items: [
      { nombre: "Resultados", ruta: "/economia", exacta: true, area: "economia" },
      { nombre: "Movimientos", ruta: "/economia/movimientos", area: "economia" },
      { nombre: "Importar Excel", ruta: "/economia/importar", area: "economia" },
    ],
  },
  {
    titulo: "Ajustes",
    items: [
      { nombre: "Personal", ruta: "/personal", area: "personal" },
      { nombre: "Energía, impuestos y objetivos", ruta: "/ajustes", area: "ajustes" },
    ],
  },
  { titulo: "Próximamente", neutra: true, items: [{ nombre: "Asistente IA" }] },
  {
    titulo: "Propietario",
    soloPropietario: true,
    items: [
      { nombre: "Administración y equipo", href: "/panel/administracion" },
      { nombre: "Registro de actividad", ruta: "/actividad" },
    ],
  },
];

export function Navegacion({ rid, color, puedeVer, propietario }: { rid: string; color: string; puedeVer: Area[]; propietario: boolean }) {
  const path = usePathname();
  const [abierto, setAbierto] = useState(false);
  const base = `/panel/${rid}`;
  const visible = (it: Item) => !it.area || (Array.isArray(it.area) ? it.area.some((a) => puedeVer.includes(a)) : puedeVer.includes(it.area));

  return (
    <>
      <button
        type="button" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} aria-controls="menu-panel"
        className="mx-4 mb-4 flex h-10 items-center justify-center rounded-xl text-[14px] font-semibold text-white lg:hidden"
        style={{ background: color }}
      >
        {abierto ? "Cerrar menú" : "Menú"}
      </button>
      <nav id="menu-panel" aria-label="Panel" className={`${abierto ? "block" : "hidden"} flex-1 overflow-y-auto px-3 pb-6 lg:block`}>
        <Link href="/panel" className="mb-4 flex h-9 items-center gap-2 rounded-lg px-3 text-[14px] font-medium text-grafito hover:bg-tinta/5">
          <span aria-hidden="true">←</span> Universo
        </Link>
        {SECCIONES.filter((s) => !s.soloPropietario || propietario).map((s) => {
          const items = s.items.filter(visible);
          if (items.length === 0) return null;
          return (
            <div key={s.titulo} className={`mb-4 ${s.soloPropietario ? "mt-6 border-t border-linea pt-4" : ""}`}>
              <p className="flex items-center gap-2 px-3 pb-1.5 text-[12px] font-bold uppercase tracking-[0.1em]" style={{ color: s.neutra ? undefined : color }}>
                {!s.neutra && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />}
                <span className={s.neutra ? "text-niebla" : ""}>{s.titulo}</span>
              </p>
              <ul>
                {items.map((it) => {
                  if (it.ruta === undefined && !it.href) {
                    return (
                      <li key={it.nombre}>
                        <span className="flex h-8 items-center rounded-lg px-3 text-[14px] text-niebla/70" aria-disabled="true">{it.nombre}</span>
                      </li>
                    );
                  }
                  const href = it.href ? it.href.replace(":rid", rid) : base + it.ruta;
                  const activo = it.href ? path === it.href : it.exacta ? path === href : path === href || path.startsWith(`${href}/`);
                  return (
                    <li key={it.nombre}>
                      <Link
                        href={href} onClick={() => setAbierto(false)} aria-current={activo ? "page" : undefined}
                        className={`flex h-8 items-center rounded-lg px-3 text-[14px] font-medium transition ${activo ? "text-white" : "text-grafito hover:bg-tinta/5"}`}
                        style={activo ? { background: color } : undefined}
                      >
                        {it.nombre}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
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
            const partes = path.replace(`/panel/${actual}`, "").split("/").filter(Boolean);
            const listado = partes[0] === "compras" && partes[1] === "proveedores" ? "/compras/proveedores"
              : partes[0] === "economia" && ["movimientos", "importar"].includes(partes[1] ?? "") ? `/economia/${partes[1]}`
              : partes[0] ? `/${partes[0]}` : "";
            router.push(`/panel/${nuevo}${listado}`);
          }}
          className="select-chevron h-11 w-full appearance-none rounded-xl border border-linea bg-white pl-9 pr-9 text-[15px] font-semibold outline-none focus:border-musgo focus:ring-4 focus:ring-musgo/15"
        >
          {restaurantes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </span>
    </label>
  );
}
