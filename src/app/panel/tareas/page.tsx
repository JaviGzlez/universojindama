import Link from "next/link";
import { redirect } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { COLOR_MUNDO, mundoDeSlug } from "@/components/mundo";
import { getContexto } from "@/lib/contexto";
import { cargarPersonas, cargarTareas, diasHasta } from "@/lib/tareas";
import { CabeceraGrupo } from "../cabecera-grupo";
import { crearTarea } from "./actions";
import { CamposTarea } from "./campos";
import { Tablero } from "./tablero";

export const metadata = { title: "Tareas" };

const VISTAS = [
  ["todas", "Todas"],
  ["mias", "Mías"],
  ["libres", "Sin asignar"],
  ["creadas", "Creadas por mí"],
] as const;
type Vista = (typeof VISTAS)[number][0];

export default async function Tareas({ searchParams }: { searchParams: Promise<{ ver?: string; r?: string; nueva?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContexto();
  if (!ctx || ctx.restaurants.length === 0) redirect("/acceso");
  const org = ctx.restaurants[0].organization_id;
  const vista: Vista = VISTAS.some(([v]) => v === sp.ver) ? (sp.ver as Vista) : "todas";
  const filtroR = ctx.restaurants.some((r) => r.id === sp.r) ? sp.r! : null;

  const [todas, personas] = await Promise.all([cargarTareas(ctx.supabase, org), cargarPersonas(ctx.supabase, org)]);
  const yo = ctx.user.id;
  const tareas = todas.filter((t) =>
    (vista === "todas" || (vista === "mias" && t.assignee_id === yo) || (vista === "libres" && !t.assignee_id) || (vista === "creadas" && t.created_by === yo))
    && (!filtroR || t.restaurant_ids.length === 0 || t.restaurant_ids.includes(filtroR)));

  const etiquetas = ctx.restaurants.map((r) => ({ id: r.id, name: r.name, color: COLOR_MUNDO[mundoDeSlug(r.slug)] }));
  const abiertas = todas.filter((t) => t.status !== "done");
  const resumen = [
    { k: "Asignadas a ti", v: abiertas.filter((t) => t.assignee_id === yo).length, href: "?ver=mias" },
    { k: "Sin asignar", v: abiertas.filter((t) => !t.assignee_id).length, href: "?ver=libres" },
    { k: "Vencidas", v: abiertas.filter((t) => (diasHasta(t.due_date) ?? 0) < 0).length, href: "?ver=todas" },
    { k: "En revisión", v: abiertas.filter((t) => t.status === "review").length, href: "?ver=todas" },
  ];
  const url = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const v = "ver" in cambios ? cambios.ver : vista;
    const r = "r" in cambios ? cambios.r : filtroR;
    if (v && v !== "todas") p.set("ver", v);
    if (r) p.set("r", r);
    const q = p.toString();
    return `/panel/tareas${q ? `?${q}` : ""}`;
  };
  const chip = (activo: boolean) =>
    `inline-flex h-9 items-center gap-2 rounded-full px-4 text-[14px] font-medium transition ${activo ? "bg-tinta text-crema" : "bg-white text-grafito ring-1 ring-linea hover:bg-crema-2"}`;

  return (
    <div className="min-h-screen bg-crema">
      <CabeceraGrupo ctx={ctx} activo="tareas" />
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-10 md:px-8 md:pt-14">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-niebla">Equipo</p>
            <h1 className="mt-1 text-[36px] font-semibold leading-tight tracking-[-0.03em] md:text-[48px]">Tareas</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-niebla">
              Crea una tarea para alguien, para un restaurante o para todo el grupo. Si la dejas sin asignar, quien la vea puede pulsar <strong className="font-medium text-grafito">Me la quedo</strong>. Arrastra las tarjetas para cambiar su estado.
            </p>
          </div>
        </div>

        <dl className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {resumen.map((x) => (
            <Link key={x.k} href={x.href} className="rounded-[20px] bg-white p-5 ring-1 ring-linea transition hover:bg-crema-2">
              <dt className="text-[13px] text-niebla">{x.k}</dt>
              <dd className={`mt-1 text-[28px] font-semibold tabular-nums ${x.k === "Vencidas" && x.v > 0 ? "text-error" : ""}`}>{x.v}</dd>
            </Link>
          ))}
        </dl>

        <details className="group mt-8 rounded-[22px] bg-white ring-1 ring-linea" open={sp.nueva === "1" || undefined}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tinta text-[18px] leading-none text-crema transition group-open:rotate-45" aria-hidden="true">+</span>
              Nueva tarea
            </span>
            <span className="text-[13px] font-normal text-niebla group-open:hidden">Responsable, restaurantes, prioridad y fecha son opcionales</span>
          </summary>
          <div className="border-t border-linea px-6 pb-6 pt-5">
            <FormularioAccion action={crearTarea} boton="Crear tarea">
              <CamposTarea personas={personas} restaurantes={etiquetas} yo={yo} restauranteInicial={filtroR ?? undefined} />
            </FormularioAccion>
          </div>
        </details>

        <div className="mb-5 mt-10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Filtrar por persona" className="flex flex-wrap gap-2">
            {VISTAS.map(([v, n]) => <Link key={v} href={url({ ver: v })} className={chip(vista === v)} aria-current={vista === v ? "page" : undefined}>{n}</Link>)}
          </nav>
          <nav aria-label="Filtrar por restaurante" className="flex flex-wrap gap-2">
            <Link href={url({ r: null })} className={chip(!filtroR)}>Todos</Link>
            {etiquetas.map((r) => (
              <Link key={r.id} href={url({ r: r.id })} className={chip(filtroR === r.id)} aria-current={filtroR === r.id ? "page" : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ background: filtroR === r.id ? "currentColor" : r.color }} aria-hidden="true" />
                {r.name}
              </Link>
            ))}
          </nav>
        </div>

        <Tablero
          tareas={tareas}
          nombres={Object.fromEntries(personas.map((p) => [p.user_id, p.display_name]))}
          restaurantes={Object.fromEntries(etiquetas.map((r) => [r.id, { name: r.name, color: r.color }]))}
          yo={yo}
          esAdmin={ctx.esAdminGrupo(org)}
        />
      </main>
    </div>
  );
}
