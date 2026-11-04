import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Selector, Tarjeta } from "@/components/ui";
import { getRestaurante, NOMBRE_ROL, type Rol, type Restaurante } from "@/lib/contexto";
import { adminDisponible } from "@/lib/supabase/admin";
import { Avatar } from "@/components/avatar";
import { usuarioDeEmail } from "@/lib/usuarios";
import { cambiarAcceso, cambiarContrasena, cambiarNombre, crearUsuario, quitarAcceso } from "./actions";

export const metadata = { title: "Usuarios" };

const DESCRIPCION_ROL: Record<Exclude<Rol, "owner">, string> = {
  admin: "Gestiona todo en sus restaurantes",
  kitchen: "Materias primas, equipos y escandallos",
  purchasing: "Materias primas y precios",
  accounting: "Personal, tarifas, impuestos y ajustes",
  viewer: "Solo consulta",
};

interface Miembro {
  user_id: string;
  nombre: string;
  email: string | null;
  roles: Rol[];
  restaurantes: (string | null)[];
}

export default async function Usuarios({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const org = restaurante.organization_id;
  const propietario = ctx.esPropietario(org);
  const restaurantesOrg = ctx.restaurants.filter((x) => x.organization_id === org);

  const [{ data: perfiles }, { data: memb }] = await Promise.all([
    ctx.supabase.from("profiles").select("user_id, display_name, email").order("display_name"),
    ctx.supabase.from("memberships").select("user_id, role, restaurant_id").eq("organization_id", org),
  ]);

  const miembros: Miembro[] = (perfiles ?? [])
    .map((p) => {
      const mios = (memb ?? []).filter((m) => m.user_id === p.user_id);
      return {
        user_id: p.user_id as string,
        nombre: p.display_name as string,
        email: p.email as string | null,
        roles: [...new Set(mios.map((m) => m.role as Rol))],
        restaurantes: mios.map((m) => m.restaurant_id as string | null),
      };
    })
    .filter((m) => !propietario || m.roles.length > 0);

  const nombreRest = (id: string | null) => (id === null ? "Todos los restaurantes" : restaurantesOrg.find((x) => x.id === id)?.name ?? "—");

  return (
    <>
      <Cabecera
        titulo="Usuarios"
        subtitulo={propietario
          ? "Crea las cuentas del equipo con su contraseña y decide qué puede hacer cada persona y en qué restaurantes."
          : "Personas del equipo. Solo el propietario puede crear usuarios o cambiar accesos."}
      />

      {propietario && !adminDisponible() && (
        <p className="mb-6 rounded-2xl bg-ambar-claro px-5 py-4 text-[14px] text-ambar">
          Para crear usuarios y cambiar contraseñas falta añadir <code>SUPABASE_SECRET_KEY</code> en las variables de entorno de Vercel (tipo
          Secret) y volver a desplegar.
        </p>
      )}

      {propietario && (
        <Tarjeta className="mb-8">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Nuevo usuario</h2>
          <p className="mt-1 text-[14px] text-niebla">La cuenta queda activa al momento, sin correo ni confirmación. Pásale el usuario y la contraseña por un canal privado.</p>
          <FormularioAccion action={crearUsuario} boton="Crear usuario" className="mt-6">
            <input type="hidden" name="rid" value={rid} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Nombre" name="nombre" required placeholder="Manuel" />
              <Campo label="Usuario" name="usuario" required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="manuel" ayuda="Con esto entrará. Sin espacios." />
              <Campo label="Contraseña" name="password" type="text" required minLength={8} autoComplete="new-password" ayuda="Mínimo 8 caracteres." />
              <SelectorRol />
            </div>
            <Alcance restaurantes={restaurantesOrg} />
          </FormularioAccion>
        </Tarjeta>
      )}

      <ul className="space-y-3">
        {miembros.map((m) => {
          const esYo = m.user_id === ctx.user.id;
          const esOwner = m.roles.includes("owner");
          const editable = propietario && !esYo && !esOwner;
          return (
            <li key={m.user_id} className="rounded-[22px] bg-white ring-1 ring-linea">
              <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between md:px-7">
                <div className="flex items-center gap-4">
                  <Avatar nombre={m.nombre} />
                  <div>
                    <p className="text-[16px] font-semibold">
                      {m.nombre} {esYo && <span className="font-normal text-niebla">(tú)</span>}
                    </p>
                    {m.email && <p className="text-[13px] text-niebla">Usuario: {usuarioDeEmail(m.email)}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {m.roles.map((x) => <Insignia key={x} tono={x === "owner" ? "ok" : "neutro"}>{NOMBRE_ROL[x]}</Insignia>)}
                  {m.restaurantes.length > 0 && (
                    <span className="text-[13px] text-niebla">{[...new Set(m.restaurantes)].map(nombreRest).join(", ")}</span>
                  )}
                </div>
              </div>

              {(editable || esYo || (propietario && esOwner)) && (
                <details className="group border-t border-linea">
                  <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-medium text-musgo md:px-7">
                    {esYo ? "Cambiar mi nombre o contraseña" : "Gestionar"}
                  </summary>
                  <div className="grid gap-6 px-5 pb-6 md:px-7 lg:grid-cols-2">
                    <FormularioAccion action={cambiarNombre} boton="Guardar nombre" limpiar={false}>
                      <input type="hidden" name="rid" value={rid} />
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <Campo label="Nombre visible" name="nombre" defaultValue={m.nombre} required />
                    </FormularioAccion>
                    {propietario && (
                      <FormularioAccion action={cambiarContrasena} boton="Cambiar contraseña">
                        <input type="hidden" name="rid" value={rid} />
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <Campo label="Nueva contraseña" name="password" type="text" minLength={8} required autoComplete="new-password" />
                      </FormularioAccion>
                    )}
                    {editable && (
                      <FormularioAccion action={cambiarAcceso} boton="Guardar acceso" limpiar={false} className="lg:col-span-2">
                        <input type="hidden" name="rid" value={rid} />
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><SelectorRol actual={m.roles[0]} /></div>
                        <Alcance restaurantes={restaurantesOrg} actuales={m.restaurantes} />
                      </FormularioAccion>
                    )}
                    {editable && (
                      <div className="lg:col-span-2">
                        <AccionRapida
                          action={quitarAcceso} etiqueta={`Quitar el acceso a ${m.nombre}`}
                          confirmar={`¿Quitar el acceso a ${m.nombre}? Su actividad pasada se conserva.`}
                          campos={{ rid, user_id: m.user_id }}
                        />
                      </div>
                    )}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SelectorRol({ actual }: { actual?: Rol }) {
  return (
    <Selector label="Rol" name="rol" defaultValue={actual && actual !== "owner" ? actual : "kitchen"} className="sm:col-span-2 lg:col-span-1">
      {(Object.keys(DESCRIPCION_ROL) as (keyof typeof DESCRIPCION_ROL)[]).map((r) => (
        <option key={r} value={r}>{NOMBRE_ROL[r]} — {DESCRIPCION_ROL[r]}</option>
      ))}
    </Selector>
  );
}

function Alcance({ restaurantes, actuales }: { restaurantes: Restaurante[]; actuales?: (string | null)[] }) {
  const todos = !actuales || actuales.includes(null);
  return (
    <fieldset className="mt-5">
      <legend className="mb-2 text-[13px] font-medium text-grafito">Restaurantes</legend>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px]">
        <label className="flex items-center gap-2">
          <input type="radio" name="alcance" value="todos" defaultChecked={todos} className="h-4 w-4 accent-musgo" /> Todos
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="alcance" value="elegir" defaultChecked={!todos} className="h-4 w-4 accent-musgo" /> Solo estos:
        </label>
        {restaurantes.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-grafito">
            <input type="checkbox" name="restaurantes" value={r.id} defaultChecked={!todos && actuales?.includes(r.id)} className="h-4 w-4 accent-musgo" />
            {r.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
