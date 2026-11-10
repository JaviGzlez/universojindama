import Link from "next/link";
import { notFound } from "next/navigation";
import { ListaActividad } from "@/components/lista-actividad";
import { Cabecera, Vacio } from "@/components/ui";
import { cargarActividad } from "@/lib/actividad";
import { getRestaurante } from "@/lib/contexto";

export const metadata = { title: "Actividad" };

export default async function Actividad({
  params, searchParams,
}: {
  params: Promise<{ rid: string }>;
  searchParams: Promise<{ ver?: string; quien?: string; antes?: string }>;
}) {
  const { rid } = await params;
  const sp = await searchParams;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.esPropietario(restaurante.organization_id)) {
    return <Vacio titulo="Solo el propietario" texto="El registro de actividad solo lo puede ver el propietario del grupo." />;
  }
  const grupo = sp.ver === "grupo";
  const quien = sp.quien && /^[0-9a-f-]{36}$/.test(sp.quien) ? sp.quien : undefined;
  const antes = sp.antes && !Number.isNaN(Date.parse(sp.antes)) ? sp.antes : undefined;

  const [{ items, siguiente }, { data: equipo }] = await Promise.all([
    cargarActividad(ctx.supabase, { restaurantes: ctx.restaurants, restauranteId: grupo ? undefined : rid, quien, antes, limite: 80, todo: true }),
    ctx.supabase.from("profiles").select("user_id, display_name").order("display_name"),
  ]);

  const url = (cambios: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const v = { ver: grupo ? "grupo" : undefined, quien, ...cambios };
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val);
    const s = q.toString();
    return `/panel/${rid}/actividad${s ? `?${s}` : ""}`;
  };
  const chip = (activo: boolean) =>
    `inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium transition ${activo ? "bg-tinta text-crema" : "bg-white text-grafito ring-1 ring-linea hover:bg-crema-2"}`;

  return (
    <>
      <Cabecera titulo="Registro de actividad" subtitulo="Cada movimiento que hace cualquier persona del equipo, con quién, qué y cuándo. Solo lo ves tú." />

      <div className="mb-8 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ámbito">
          <Link href={url({ ver: undefined, antes: undefined })} className={chip(!grupo)} aria-current={!grupo ? "true" : undefined}>{restaurante.name}</Link>
          <Link href={url({ ver: "grupo", antes: undefined })} className={chip(grupo)} aria-current={grupo ? "true" : undefined}>Todo el grupo</Link>
        </div>
        {(equipo?.length ?? 0) > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Persona">
            <Link href={url({ quien: undefined, antes: undefined })} className={chip(!quien)}>Todos</Link>
            {equipo!.map((p) => (
              <Link key={p.user_id} href={url({ quien: p.user_id, antes: undefined })} className={chip(quien === p.user_id)}>
                {p.display_name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <Vacio titulo="Sin actividad todavía" texto="Cuando alguien añada materias primas, precios, equipos o cambie accesos, aparecerá aquí." />
      ) : (
        <ListaActividad items={items} tz={restaurante.timezone} mostrarRestaurante={grupo} />
      )}

      {siguiente && (
        <div className="mt-8 text-center">
          <Link href={url({ antes: siguiente })} className="inline-flex h-10 items-center rounded-full bg-white px-5 text-[14px] font-medium ring-1 ring-linea hover:bg-crema-2">
            Ver actividad anterior
          </Link>
        </div>
      )}
    </>
  );
}
