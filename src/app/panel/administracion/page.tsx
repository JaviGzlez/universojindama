import Link from "next/link";
import { CabeceraGrupo } from "../cabecera-grupo";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { ListaActividad } from "@/components/lista-actividad";
import { Campo, Insignia, Tarjeta, Vacio } from "@/components/ui";
import { cargarActividad } from "@/lib/actividad";
import { AREAS, getContexto, NOMBRE_AREA, NOMBRE_ROL, type Area, type Nivel, type Rol } from "@/lib/contexto";
import { adminDisponible } from "@/lib/supabase/admin";
import { usuarioDeEmail } from "@/lib/usuarios";
import { cambiarAcceso, cambiarContrasena, cambiarNombre, crearUsuario, quitarAcceso } from "./actions";
import { SelectorPermisos } from "./permisos";

export const metadata = { title: "Administración" };

interface Miembro {
  user_id: string;
  nombre: string;
  email: string | null;
  roles: Rol[];
  restaurantes: (string | null)[];
  permisos: Partial<Record<Area, Nivel>> | null;
}

export default async function Administracion({ searchParams }: { searchParams: Promise<{ ver?: string; quien?: string; rest?: string; antes?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContexto();
  if (!ctx) redirect("/acceso");
  const org = ctx.restaurants[0]?.organization_id;
  if (!org || !ctx.esPropietario(org)) redirect("/panel");
  const sb = ctx.supabase;
  const restaurantes = ctx.restaurants.filter((r) => r.organization_id === org);
  const tz = restaurantes[0].timezone;
  const pestana = sp.ver === "actividad" ? "actividad" : "equipo";

  return (
    <div className="min-h-screen bg-crema">
      <CabeceraGrupo ctx={ctx} activo="administracion" />
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-10 md:px-8">
        <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-niebla">Solo propietario</p>
        <h1 className="mt-1 text-[40px] font-semibold tracking-[-0.03em] md:text-[48px]">Administración</h1>
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Secciones">
          <Link href="/panel/administracion" className={`h-9 rounded-full px-4 py-2 text-[13px] font-medium ${pestana === "equipo" ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>Equipo y permisos</Link>
          <Link href="/panel/administracion?ver=actividad" className={`h-9 rounded-full px-4 py-2 text-[13px] font-medium ${pestana === "actividad" ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea"}`}>Registro de actividad</Link>
          <Link href={`/panel/${restaurantes[0].id}/economia/importar`} className="h-9 rounded-full bg-white px-4 py-2 text-[13px] font-medium ring-1 ring-linea">Importar Excel</Link>
        </nav>
        <div className="mt-8">
          {pestana === "equipo" ? <Equipo org={org} restaurantes={restaurantes} /> : <Registro restaurantes={restaurantes} tz={tz} sp={sp} />}
        </div>
      </main>
    </div>
  );

  async function Equipo({ org, restaurantes }: { org: string; restaurantes: { id: string; name: string }[] }) {
    const [{ data: perfiles }, { data: memb }] = await Promise.all([
      sb.from("profiles").select("user_id, display_name, email").order("display_name"),
      sb.from("memberships").select("user_id, role, restaurant_id, permissions").eq("organization_id", org),
    ]);
    const miembros: Miembro[] = (perfiles ?? []).map((p) => {
      const mios = (memb ?? []).filter((m) => m.user_id === p.user_id);
      return {
        user_id: p.user_id, nombre: p.display_name, email: p.email,
        roles: [...new Set(mios.map((m) => m.role as Rol))], restaurantes: mios.map((m) => m.restaurant_id),
        permisos: (mios[0]?.permissions ?? null) as Miembro["permisos"],
      };
    }).filter((m) => m.roles.length > 0);
    const nombreRest = (id: string | null) => (id === null ? "Todos los restaurantes" : restaurantes.find((x) => x.id === id)?.name ?? "—");

    return (
      <>
        {!adminDisponible() && (
          <p className="mb-6 rounded-2xl bg-ambar-claro px-5 py-4 text-[14px] text-ambar">
            Para crear usuarios y cambiar contraseñas falta añadir <code>SUPABASE_SECRET_KEY</code> (tipo Secret) en Vercel y volver a desplegar.
          </p>
        )}
        <Tarjeta className="mb-8">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Nuevo usuario</h2>
          <p className="mt-1 text-[14px] text-niebla">Entra con usuario y contraseña, sin correo. Elige sus restaurantes y qué puede ver o editar en cada apartado.</p>
          <FormularioAccion action={crearUsuario} boton="Crear usuario" className="mt-6">
            <input type="hidden" name="org" value={org} />
            <div className="mb-6 grid gap-4 sm:grid-cols-3">
              <Campo label="Nombre" name="nombre" required placeholder="Manuel" />
              <Campo label="Usuario" name="usuario" required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="manuel" />
              <Campo label="Contraseña" name="password" type="text" required minLength={8} autoComplete="new-password" ayuda="Mínimo 8 caracteres." />
            </div>
            <SelectorPermisos restaurantes={restaurantes} />
          </FormularioAccion>
        </Tarjeta>

        <ul className="space-y-3">
          {miembros.map((m) => {
            const esYo = m.user_id === ctx!.user.id;
            const esOwner = m.roles.includes("owner");
            const resumen = m.roles.includes("admin") || esOwner ? null
              : AREAS.filter((a) => (m.permisos?.[a] ?? "none") !== "none").map((a) => `${NOMBRE_AREA[a]}${m.permisos?.[a] === "read" ? " (ver)" : ""}`);
            return (
              <li key={m.user_id} className="rounded-[22px] bg-white ring-1 ring-linea">
                <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between md:px-7">
                  <div className="flex items-center gap-4">
                    <Avatar nombre={m.nombre} />
                    <div>
                      <p className="text-[16px] font-semibold">{m.nombre} {esYo && <span className="font-normal text-niebla">(tú)</span>}</p>
                      {m.email && <p className="text-[13px] text-niebla">Usuario: {usuarioDeEmail(m.email)}</p>}
                    </div>
                  </div>
                  <div className="max-w-xl sm:text-right">
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      {m.roles.map((x) => <Insignia key={x} tono={x === "owner" ? "ok" : "neutro"}>{x === "viewer" && m.permisos ? "A medida" : NOMBRE_ROL[x]}</Insignia>)}
                      <span className="text-[13px] text-niebla">{[...new Set(m.restaurantes)].map(nombreRest).join(", ")}</span>
                    </div>
                    {resumen && <p className="mt-1.5 text-[12px] leading-snug text-niebla">{resumen.length ? resumen.join(" · ") : "Sin apartados"}</p>}
                  </div>
                </div>
                <details className="border-t border-linea">
                  <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-medium text-musgo md:px-7">{esYo ? "Cambiar mi nombre o contraseña" : "Gestionar"}</summary>
                  <div className="grid gap-6 px-5 pb-6 md:px-7 lg:grid-cols-2">
                    <FormularioAccion action={cambiarNombre} boton="Guardar nombre" limpiar={false}>
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <Campo label="Nombre visible" name="nombre" defaultValue={m.nombre} required />
                    </FormularioAccion>
                    <FormularioAccion action={cambiarContrasena} boton="Cambiar contraseña">
                      <input type="hidden" name="org" value={org} /><input type="hidden" name="user_id" value={m.user_id} />
                      <Campo label="Nueva contraseña" name="password" type="text" minLength={8} required autoComplete="new-password" />
                    </FormularioAccion>
                    {!esYo && !esOwner && (
                      <FormularioAccion action={cambiarAcceso} boton="Guardar acceso y permisos" limpiar={false} className="lg:col-span-2">
                        <input type="hidden" name="org" value={org} /><input type="hidden" name="user_id" value={m.user_id} />
                        <SelectorPermisos
                          rolInicial={(m.roles[0] === "owner" ? "admin" : m.roles[0]) as "admin" | "kitchen" | "purchasing" | "accounting" | "viewer"}
                          permisosIniciales={m.permisos} restaurantes={restaurantes} actuales={m.restaurantes}
                        />
                      </FormularioAccion>
                    )}
                    {!esYo && !esOwner && (
                      <div className="lg:col-span-2">
                        <AccionRapida action={quitarAcceso} etiqueta={`Quitar el acceso a ${m.nombre}`}
                          confirmar={`¿Quitar el acceso a ${m.nombre}? Su actividad pasada se conserva.`} campos={{ org, user_id: m.user_id }} />
                      </div>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  async function Registro({ restaurantes, tz, sp }: { restaurantes: { id: string; name: string }[]; tz: string; sp: { quien?: string; rest?: string; antes?: string } }) {
    const quien = sp.quien && /^[0-9a-f-]{36}$/.test(sp.quien) ? sp.quien : undefined;
    const rest = restaurantes.find((r) => r.id === sp.rest)?.id;
    const antes = sp.antes && !Number.isNaN(Date.parse(sp.antes)) ? sp.antes : undefined;
    const [{ items, siguiente }, { data: equipo }] = await Promise.all([
      cargarActividad(sb, { restaurantes: ctx!.restaurants, restauranteId: rest, soloRestaurante: Boolean(rest), quien, antes, limite: 80, todo: true }),
      sb.from("profiles").select("user_id, display_name").order("display_name"),
    ]);
    const url = (o: Record<string, string | undefined>) => {
      const q = new URLSearchParams(Object.entries({ ver: "actividad", quien, rest, ...o }).filter(([, v]) => v) as [string, string][]);
      return `/panel/administracion?${q}`;
    };
    const chip = (a: boolean) => `inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium ${a ? "bg-tinta text-crema" : "bg-white text-grafito ring-1 ring-linea hover:bg-crema-2"}`;
    return (
      <>
        <p className="mb-5 max-w-2xl text-[14px] text-niebla">Cada cambio que hace cualquier persona del equipo, con quién, qué y cuándo. Solo lo ves tú.</p>
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Link href={url({ rest: undefined, antes: undefined })} className={chip(!rest)}>Todo el grupo</Link>
            {restaurantes.map((r) => <Link key={r.id} href={url({ rest: r.id, antes: undefined })} className={chip(rest === r.id)}>{r.name}</Link>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={url({ quien: undefined, antes: undefined })} className={chip(!quien)}>Todas las personas</Link>
            {(equipo ?? []).map((p) => <Link key={p.user_id} href={url({ quien: p.user_id, antes: undefined })} className={chip(quien === p.user_id)}>{p.display_name}</Link>)}
          </div>
        </div>
        {items.length === 0 ? <Vacio titulo="Sin movimientos" texto="Aquí aparecerá cada cambio." /> : <ListaActividad items={items} tz={tz} />}
        {siguiente && (
          <div className="mt-8 text-center">
            <Link href={url({ antes: siguiente })} className="inline-flex h-10 items-center rounded-full bg-white px-5 text-[14px] font-medium ring-1 ring-linea hover:bg-crema-2">Ver anteriores</Link>
          </div>
        )}
      </>
    );
  }
}
