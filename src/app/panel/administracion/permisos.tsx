"use client";

import { useState } from "react";

export const AREAS_UI = [
  ["recetas", "Recetas y elaboraciones"],
  ["materias", "Materias primas"],
  ["equipos", "Equipos y consumibles"],
  ["compras", "Compras, facturas y proveedores"],
  ["inventario", "Inventario y mermas"],
  ["carta", "Carta y canales"],
  ["ventas", "Ventas"],
  ["economia", "Economía y resultados"],
  ["personal", "Personal"],
  ["ajustes", "Energía, impuestos y objetivos"],
] as const;
type Area = (typeof AREAS_UI)[number][0];
type Nivel = "none" | "read" | "write";
type Rol = "admin" | "kitchen" | "purchasing" | "accounting" | "viewer";

// mismo reparto que public.role_area_default
const PRESET: Record<Exclude<Rol, "admin">, [Area[], Area[]]> = {
  kitchen: [["recetas", "materias", "equipos", "inventario"], ["carta", "personal", "ajustes"]],
  purchasing: [["materias", "compras", "inventario"], ["recetas", "equipos", "personal", "ajustes"]],
  accounting: [["economia", "ventas", "carta", "personal", "ajustes"], ["compras", "recetas", "inventario", "materias", "equipos"]],
  viewer: [[], AREAS_UI.map((a) => a[0])],
};
const preset = (rol: Rol): Record<Area, Nivel> =>
  Object.fromEntries(AREAS_UI.map(([a]) => [a, rol === "admin" ? "write" : PRESET[rol][0].includes(a) ? "write" : PRESET[rol][1].includes(a) ? "read" : "none"])) as Record<Area, Nivel>;

const PERFILES: [Rol, string, string][] = [
  ["admin", "Administrador", "Todo, en los restaurantes elegidos"],
  ["kitchen", "Cocina", "Recetas, materias, equipos e inventario"],
  ["purchasing", "Compras", "Materias primas, facturas e inventario"],
  ["accounting", "Administración", "Economía, ventas, carta y personal"],
  ["viewer", "A medida / Consulta", "Empieza solo viendo; marca lo que quieras"],
];

/**
 * Perfil + restaurantes + casillas No / Ver / Editar por apartado.
 * El perfil rellena las casillas; luego se puede cambiar cualquiera.
 */
export function SelectorPermisos({
  rolInicial = "kitchen", permisosIniciales, restaurantes, actuales,
}: {
  rolInicial?: Rol;
  permisosIniciales?: Partial<Record<Area, Nivel>> | null;
  restaurantes: { id: string; name: string }[];
  actuales?: (string | null)[];
}) {
  const [rol, setRol] = useState<Rol>(rolInicial);
  const [perm, setPerm] = useState<Record<Area, Nivel>>({ ...preset(rolInicial), ...(permisosIniciales ?? {}) });
  const todos = !actuales || actuales.includes(null);
  const [alcance, setAlcance] = useState<"todos" | "elegir">(todos ? "todos" : "elegir");

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-grafito">Perfil</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {PERFILES.map(([r, nombre, desc]) => (
            <label key={r} className={`cursor-pointer rounded-2xl px-4 py-3 ring-1 transition ${rol === r ? "bg-tinta text-crema ring-tinta" : "bg-white ring-linea hover:bg-crema-2"}`}>
              <input type="radio" name="rol" value={r} checked={rol === r} onChange={() => { setRol(r); setPerm(preset(r)); }} className="sr-only" />
              <span className="block text-[14px] font-semibold">{nombre}</span>
              <span className={`block text-[12px] leading-snug ${rol === r ? "text-crema/70" : "text-niebla"}`}>{desc}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-grafito">Restaurantes</legend>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="alcance" value="todos" checked={alcance === "todos"} onChange={() => setAlcance("todos")} className="h-4 w-4 accent-musgo" /> Todos
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="alcance" value="elegir" checked={alcance === "elegir"} onChange={() => setAlcance("elegir")} className="h-4 w-4 accent-musgo" /> Solo:
          </label>
          {restaurantes.map((r) => (
            <label key={r.id} className={`flex items-center gap-2 ${alcance === "todos" ? "opacity-40" : ""}`}>
              <input type="checkbox" name="restaurantes" value={r.id} disabled={alcance === "todos"}
                defaultChecked={!todos && actuales?.includes(r.id)} className="h-4 w-4 accent-musgo" />
              {r.name}
            </label>
          ))}
        </div>
      </fieldset>

      {rol === "admin" ? (
        <p className="rounded-2xl bg-crema-2 px-4 py-3 text-[13px] text-grafito">El administrador puede ver y editar todos los apartados de sus restaurantes. Para limitarlo, elige otro perfil.</p>
      ) : (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-grafito">Qué puede hacer en cada apartado</legend>
          <div className="overflow-hidden rounded-2xl ring-1 ring-linea">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="bg-crema-2 text-[12px] uppercase tracking-[0.06em] text-niebla">
                  <th className="px-4 py-2 text-left font-medium">Apartado</th>
                  <th className="w-20 px-2 py-2 font-medium">No</th>
                  <th className="w-20 px-2 py-2 font-medium">Ver</th>
                  <th className="w-20 px-2 py-2 font-medium">Editar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea/70 bg-white">
                {AREAS_UI.map(([a, nombre]) => (
                  <tr key={a}>
                    <td className="px-4 py-2.5">{nombre}</td>
                    {(["none", "read", "write"] as Nivel[]).map((n) => (
                      <td key={n} className="px-2 py-2.5 text-center">
                        <input type="radio" name={`perm_${a}`} value={n} checked={perm[a] === n} aria-label={`${nombre}: ${n === "none" ? "no" : n === "read" ? "ver" : "editar"}`}
                          onChange={() => setPerm({ ...perm, [a]: n })} className="h-4 w-4 accent-musgo" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-niebla">Materias primas, equipos, personal y ajustes siempre se pueden consultar dentro de los escandallos, porque los necesita el cálculo.</p>
        </fieldset>
      )}
    </div>
  );
}
