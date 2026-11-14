import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { COLOR_MUNDO, mundoDeSlug } from "@/components/mundo";
import { Tarjeta, claseInput } from "@/components/ui";
import { getContexto } from "@/lib/contexto";
import { COLS_TAREA, NOMBRE_ESTADO, NOMBRE_PRIORIDAD, cargarPersonas, diasHasta, iniciales, textoPlazo, type Tarea } from "@/lib/tareas";
import { CabeceraGrupo } from "../../cabecera-grupo";
import { borrarTarea, comentarTarea, editarTarea } from "../actions";
import { CamposTarea } from "../campos";
import { BotonesEstado } from "./botones";

export const metadata = { title: "Tarea" };

const fechaHora = (s: string) => new Date(s).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

export default async function DetalleTarea({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContexto();
  if (!ctx || ctx.restaurants.length === 0) notFound();
  const { data } = await ctx.supabase.from("tasks").select(COLS_TAREA).eq("id", id).maybeSingle();
  if (!data) notFound();
  const t = data as Tarea;
  const [personas, { data: comentarios }] = await Promise.all([
    cargarPersonas(ctx.supabase, t.organization_id),
    ctx.supabase.from("task_comments").select("id, author_id, body, created_at").eq("task_id", id).order("created_at"),
  ]);
  const nombre = (u: string | null) => (u ? personas.find((p) => p.user_id === u)?.display_name ?? "Usuario" : "—");
  const yo = ctx.user.id;
  const esAdmin = ctx.esAdminGrupo(t.organization_id);
  const gestiona = esAdmin || t.created_by === yo || t.assignee_id === yo;
  const etiquetas = ctx.restaurants.map((r) => ({ id: r.id, name: r.name, color: COLOR_MUNDO[mundoDeSlug(r.slug)] }));
  const dias = t.status === "done" ? null : diasHasta(t.due_date);

  return (
    <div className="min-h-screen bg-crema">
      <CabeceraGrupo ctx={ctx} activo="tareas" />
      <main className="mx-auto max-w-4xl px-5 pb-24 pt-10 md:px-8">
        <Link href="/panel/tareas" className="text-[13px] font-medium text-niebla hover:text-tinta">← Tareas</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="rounded-full bg-tinta px-2.5 py-0.5 font-semibold text-crema">{NOMBRE_ESTADO[t.status]}</span>
          <span className="rounded-full bg-crema-2 px-2.5 py-0.5 font-medium text-grafito">Prioridad {NOMBRE_PRIORIDAD[t.priority].toLowerCase()}</span>
          {t.restaurant_ids.length === 0
            ? <span className="rounded-full bg-crema-2 px-2.5 py-0.5 font-medium text-niebla">Todo el grupo</span>
            : t.restaurant_ids.map((r) => {
              const e = etiquetas.find((x) => x.id === r);
              return e && <span key={r} className="rounded-full px-2.5 py-0.5 font-semibold text-white" style={{ background: e.color }}>{e.name}</span>;
            })}
          {textoPlazo(dias) && <span className={`rounded-full px-2.5 py-0.5 font-medium ${dias! < 0 ? "bg-error text-white" : "bg-terracota-claro text-terracota"}`}>{textoPlazo(dias)}</span>}
        </div>
        <h1 className="mt-3 text-[32px] font-semibold leading-tight tracking-[-0.03em] md:text-[40px]">{t.title}</h1>
        {t.description && <p className="mt-3 whitespace-pre-line text-[16px] leading-relaxed text-grafito">{t.description}</p>}

        <dl className="mt-6 grid grid-cols-2 gap-3 text-[14px] md:grid-cols-4">
          {[
            ["Responsable", t.assignee_id ? (t.assignee_id === yo ? "Tú" : nombre(t.assignee_id)) : "Sin asignar"],
            ["Fecha límite", t.due_date ? new Date(t.due_date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "long" }) : "—"],
            ["Creada por", `${nombre(t.created_by)} · ${fechaHora(t.created_at)}`],
            [t.status === "done" ? "Completada por" : "Última actualización", t.status === "done" && t.completed_at ? `${nombre(t.completed_by)} · ${fechaHora(t.completed_at)}` : fechaHora(t.updated_at)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[18px] bg-white p-4 ring-1 ring-linea"><dt className="text-[12px] text-niebla">{k}</dt><dd className="mt-1 font-medium">{v}</dd></div>
          ))}
        </dl>

        <BotonesEstado id={t.id} estado={t.status} libre={!t.assignee_id} mia={t.assignee_id === yo} gestiona={gestiona} />

        <section className="mt-10">
          <h2 className="mb-3 text-[22px] font-semibold tracking-[-0.02em]">Comentarios</h2>
          <ul className="space-y-3">
            {(comentarios ?? []).map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-crema-2 text-[12px] font-semibold text-grafito" aria-hidden="true">{iniciales(nombre(c.author_id))}</span>
                <div className="flex-1 rounded-2xl bg-white px-4 py-3 ring-1 ring-linea">
                  <p className="text-[12px] text-niebla"><strong className="font-semibold text-grafito">{c.author_id === yo ? "Tú" : nombre(c.author_id)}</strong> · {fechaHora(c.created_at)}</p>
                  <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{c.body}</p>
                </div>
              </li>
            ))}
            {(comentarios ?? []).length === 0 && <li className="text-[14px] text-niebla">Sin comentarios todavía. Úsalos para avisar de avances o dejar dudas.</li>}
          </ul>
          <FormularioAccion action={comentarTarea} boton="Comentar" className="mt-4">
            <input type="hidden" name="task_id" value={t.id} />
            <label className="sr-only" htmlFor="body">Comentario</label>
            <textarea id="body" name="body" rows={2} required maxLength={2000} placeholder="Escribe un comentario…" className={`${claseInput} h-auto py-2.5`} />
          </FormularioAccion>
        </section>

        {gestiona && (
          <Tarjeta className="mt-10">
            <h2 className="text-[17px] font-semibold">Editar tarea</h2>
            <FormularioAccion action={editarTarea} boton="Guardar cambios" limpiar={false} className="mt-5">
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="version" value={t.version} />
              <CamposTarea personas={personas} restaurantes={etiquetas} tarea={t} yo={yo} />
            </FormularioAccion>
          </Tarjeta>
        )}

        {(esAdmin || t.created_by === yo) && (
          <FormularioAccion action={borrarTarea} boton="Borrar tarea" className="mt-6">
            <input type="hidden" name="id" value={t.id} />
            <p className="text-[13px] text-niebla">Borrarla la quita para todos. Si ya está hecha, mejor márcala como completada.</p>
          </FormularioAccion>
        )}
      </main>
    </div>
  );
}
