"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ESTADOS, NOMBRE_ESTADO, NOMBRE_PRIORIDAD, diasHasta, iniciales, textoPlazo, textoResponsables, colorAvatar, type Estado, type Tarea } from "@/lib/tareas";
import { cambiarTarea } from "./actions";

interface Props {
  tareas: Tarea[];
  nombres: Record<string, string>;
  restaurantes: Record<string, { name: string; color: string }>;
  yo: string;
  esAdmin: boolean;
}

const PESO = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
const PUNTO: Record<Estado, string> = {
  pending: "var(--color-niebla)",
  in_progress: "var(--color-ambar)",
  review: "#4a68d1",
  done: "var(--color-musgo)",
};

function ordenar(a: Tarea, b: Tarea) {
  if (a.status === "done" && b.status === "done") return (b.completed_at ?? "").localeCompare(a.completed_at ?? "");
  return PESO[a.priority] - PESO[b.priority]
    || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
    || a.position - b.position;
}

export function Tablero({ tareas, nombres, restaurantes, yo, esAdmin }: Props) {
  const [lista, setLista] = useState(tareas);
  const [aviso, setAviso] = useState("");
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<Estado | null>(null);
  const [, start] = useTransition();
  useEffect(() => setLista(tareas), [tareas]);
  useEffect(() => {
    if (!aviso) return;
    const h = setTimeout(() => setAviso(""), 4000);
    return () => clearTimeout(h);
  }, [aviso]);

  const gestiona = (t: Tarea) => esAdmin || t.created_by === yo || t.assignee_ids.includes(yo);

  function aplicar(t: Tarea, cambio: { status?: Estado; asignarme?: boolean; soltar?: boolean }) {
    const antes = lista;
    setLista((l) => l.map((x) => x.id !== t.id ? x : {
      ...x,
      status: cambio.status ?? x.status,
      assignee_ids: cambio.asignarme ? [...new Set([...x.assignee_ids, yo])] : cambio.soltar ? x.assignee_ids.filter((u) => u !== yo) : x.assignee_ids,
      completed_at: (cambio.status ?? x.status) === "done" ? x.completed_at ?? new Date().toISOString() : null,
    }));
    start(async () => {
      const r = await cambiarTarea(t.id, cambio);
      if (!r.ok) { setLista(antes); setAviso(r.mensaje); }
    });
  }

  function soltarEn(estado: Estado) {
    const t = lista.find((x) => x.id === arrastrando);
    setArrastrando(null); setSobre(null);
    if (!t || t.status === estado) return;
    if (gestiona(t)) aplicar(t, { status: estado });
    else if (t.assignee_ids.length === 0 && estado === "in_progress") aplicar(t, { status: estado, asignarme: true });
    else setAviso("Solo puedes moverla si es tuya o la has creado. Si está libre, arrástrala a «En curso» para quedártela, o pulsa «Me apunto».");
  }

  return (
    <>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {aviso && <p className="pointer-events-auto rounded-full bg-tinta px-5 py-3 text-[14px] text-crema shadow-lg">{aviso}</p>}
      </div>
      <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {ESTADOS.map((estado) => {
          const col = lista.filter((t) => t.status === estado).sort(ordenar);
          return (
            <section
              key={estado} aria-label={NOMBRE_ESTADO[estado]}
              onDragOver={(e) => { if (arrastrando) { e.preventDefault(); setSobre(estado); } }}
              onDragLeave={() => setSobre((s) => (s === estado ? null : s))}
              onDrop={(e) => { e.preventDefault(); soltarEn(estado); }}
              className={`flex w-[82vw] max-w-[340px] shrink-0 snap-start flex-col rounded-[22px] p-3 transition md:w-auto md:max-w-none ${sobre === estado ? "bg-tinta/[0.07] ring-2 ring-tinta/15" : "bg-crema-2/70"}`}
            >
              <h2 className="flex items-center gap-2 px-2 pb-3 pt-1 text-[14px] font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ background: PUNTO[estado] }} aria-hidden="true" />
                {NOMBRE_ESTADO[estado]}
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[12px] font-medium tabular-nums text-niebla">{col.length}</span>
              </h2>
              <ul className="flex min-h-24 flex-col gap-2.5">
                {col.map((t) => (
                  <TarjetaTarea
                    key={t.id} t={t} yo={yo} nombres={nombres} restaurantes={restaurantes}
                    gestiona={gestiona(t)} arrastrando={arrastrando === t.id}
                    onDrag={(id) => setArrastrando(id)} onCambio={(c) => aplicar(t, c)}
                  />
                ))}
                {col.length === 0 && (
                  <li className="rounded-2xl border border-dashed border-linea px-4 py-6 text-center text-[13px] text-niebla">
                    {estado === "done" ? "Nada completado aún" : "Arrastra aquí"}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function TarjetaTarea({
  t, yo, nombres, restaurantes, gestiona, arrastrando, onDrag, onCambio,
}: {
  t: Tarea; yo: string; nombres: Record<string, string>; restaurantes: Props["restaurantes"];
  gestiona: boolean; arrastrando: boolean;
  onDrag: (id: string | null) => void;
  onCambio: (c: { status?: Estado; asignarme?: boolean; soltar?: boolean }) => void;
}) {
  const i = ESTADOS.indexOf(t.status);
  const dias = t.status === "done" ? null : diasHasta(t.due_date);
  const plazo = textoPlazo(dias);
  const libre = t.assignee_ids.length === 0;
  const mia = t.assignee_ids.includes(yo);
  const arrastrable = gestiona || libre;
  return (
    <li
      draggable={arrastrable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); onDrag(t.id); }}
      onDragEnd={() => onDrag(null)}
      className={`group rounded-2xl bg-white p-4 ring-1 ring-linea transition hover:shadow-[0_6px_24px_-12px_rgba(0,0,0,.25)] ${arrastrable ? "cursor-grab active:cursor-grabbing" : ""} ${arrastrando ? "opacity-40" : ""} ${t.priority === "urgent" && t.status !== "done" ? "ring-terracota/60" : ""}`}
    >
      <div className="flex items-start gap-2">
        <Link href={`/panel/tareas/${t.id}`} className={`flex-1 text-[15px] font-medium leading-snug hover:underline ${t.status === "done" ? "text-niebla line-through decoration-niebla/50" : "text-tinta"}`}>
          {t.title}
        </Link>
        {(t.priority === "urgent" || t.priority === "high") && t.status !== "done" && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.priority === "urgent" ? "bg-terracota text-white" : "bg-terracota-claro text-terracota"}`}>
            {NOMBRE_PRIORIDAD[t.priority]}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {t.restaurant_ids.length === 0 ? (
          <span className="rounded-full bg-crema-2 px-2 py-0.5 text-[11px] font-medium text-niebla">Todo el grupo</span>
        ) : t.restaurant_ids.map((rid) => restaurantes[rid] && (
          <span key={rid} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: restaurantes[rid].color }}>
            {restaurantes[rid].name}
          </span>
        ))}
        {plazo && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${dias! < 0 ? "bg-error text-white" : dias! <= 1 ? "bg-terracota-claro text-terracota" : "bg-ambar-claro text-ambar"}`}>{plazo}</span>
        )}
        {!plazo && t.due_date && t.status !== "done" && (
          <span className="rounded-full bg-crema-2 px-2 py-0.5 text-[11px] text-grafito">{new Date(t.due_date + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {libre ? (
          t.status === "done" ? <span className="text-[12px] text-niebla">Sin responsable</span> : (
            <button type="button" onClick={() => onCambio({ asignarme: true, status: t.status === "pending" ? "in_progress" : undefined })}
              className="h-8 rounded-full bg-tinta px-3.5 text-[12px] font-semibold text-crema transition hover:bg-grafito">
              Me la quedo
            </button>
          )
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-grafito">
            <span className="flex shrink-0 -space-x-2" aria-hidden="true">
              {[...t.assignee_ids].sort((a, b) => (a === yo ? -1 : b === yo ? 1 : 0)).slice(0, 4).map((u) => (
                <span key={u} title={nombres[u]} style={u === yo ? undefined : colorAvatar(u)} className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-white ${u === yo ? "bg-tinta text-crema" : ""}`}>
                  {iniciales(nombres[u] ?? "?")}
                </span>
              ))}
            </span>
            <span className="line-clamp-2 leading-tight">{textoResponsables(t.assignee_ids, nombres, yo)}</span>
            {!mia && t.status !== "done" && (
              <button type="button" onClick={() => onCambio({ asignarme: true })}
                className="ml-auto shrink-0 rounded-full px-2 py-1 text-[12px] font-semibold text-tinta underline-offset-2 hover:bg-crema-2 hover:underline">
                Me apunto
              </button>
            )}
          </span>
        )}
        {gestiona && (
          <span className="ml-auto flex gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            {i > 0 && (
              <button type="button" onClick={() => onCambio({ status: ESTADOS[i - 1] })} aria-label={`Mover a ${NOMBRE_ESTADO[ESTADOS[i - 1]]}`} title={`Mover a ${NOMBRE_ESTADO[ESTADOS[i - 1]]}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[15px] text-grafito hover:bg-crema-2">←</button>
            )}
            {i < ESTADOS.length - 1 && (
              <button type="button" onClick={() => onCambio({ status: ESTADOS[i + 1] })} aria-label={`Mover a ${NOMBRE_ESTADO[ESTADOS[i + 1]]}`} title={`Mover a ${NOMBRE_ESTADO[ESTADOS[i + 1]]}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[15px] text-grafito hover:bg-crema-2">→</button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
