import { Campo, Selector, claseInput } from "@/components/ui";
import { NOMBRE_ESTADO, NOMBRE_PRIORIDAD, ESTADOS, PRIORIDADES, iniciales, colorAvatar, type Persona, type Tarea } from "@/lib/tareas";

export interface RestauranteEtiqueta { id: string; name: string; color: string }

/** Campos comunes de «Nueva tarea» y «Editar tarea». */
export function CamposTarea({
  personas, restaurantes, tarea, yo, restauranteInicial,
}: {
  personas: Persona[];
  restaurantes: RestauranteEtiqueta[];
  tarea?: Tarea;
  yo: string;
  restauranteInicial?: string;
}) {
  const marcados = tarea?.restaurant_ids ?? (restauranteInicial ? [restauranteInicial] : []);
  const responsables = tarea?.assignee_ids ?? [];
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Campo label="Qué hay que hacer" name="title" required maxLength={200} defaultValue={tarea?.title}
          placeholder="Revisar alérgenos de la carta de otoño" className="md:col-span-3" />
        <label className="block md:col-span-3">
          <span className="mb-1.5 block text-[13px] font-medium text-grafito">Detalles <span className="font-normal text-niebla">(opcional)</span></span>
          <textarea name="description" rows={3} maxLength={4000} defaultValue={tarea?.description ?? ""}
            placeholder="Pasos, enlaces, qué se considera terminado…" className={`${claseInput} h-auto py-2.5 leading-relaxed`} />
        </label>
        <Selector label="Estado" name="status" defaultValue={tarea?.status ?? "pending"}>
          {ESTADOS.map((e) => <option key={e} value={e}>{NOMBRE_ESTADO[e]}</option>)}
        </Selector>
        <Selector label="Prioridad" name="priority" defaultValue={tarea?.priority ?? "normal"}>
          {PRIORIDADES.map((p) => <option key={p} value={p}>{NOMBRE_PRIORIDAD[p]}</option>)}
        </Selector>
        <Campo label="Fecha límite" name="due_date" type="date" defaultValue={tarea?.due_date ?? ""} />
      </div>
      <fieldset className="mt-5">
        <legend className="mb-2 text-[13px] font-medium text-grafito">
          Responsables <span className="font-normal text-niebla">— marca una o varias personas; sin marcar, cualquiera puede quedársela</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {personas.map((p) => (
            <label key={p.user_id} className="cursor-pointer">
              <input type="checkbox" name="assignee_ids" value={p.user_id} defaultChecked={responsables.includes(p.user_id)} className="peer sr-only" />
              <span className="inline-flex h-9 items-center gap-2 rounded-full bg-crema-2 pl-1 pr-4 text-[14px] font-medium text-grafito transition peer-checked:bg-tinta peer-checked:text-crema peer-focus-visible:ring-2 peer-focus-visible:ring-tinta/40">
                <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold" style={colorAvatar(p.user_id)} aria-hidden="true">{iniciales(p.display_name)}</span>
                {p.display_name}{p.user_id === yo ? " (yo)" : ""}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-5">
        <legend className="mb-2 text-[13px] font-medium text-grafito">
          Restaurantes <span className="font-normal text-niebla">— ninguno marcado = todo el grupo</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {restaurantes.map((r) => (
            <label key={r.id} className="cursor-pointer">
              <input type="checkbox" name="restaurant_ids" value={r.id} defaultChecked={marcados.includes(r.id)} className="peer sr-only" />
              <span
                className="inline-flex h-9 items-center gap-2 rounded-full bg-crema-2 px-4 text-[14px] font-medium text-grafito transition peer-checked:text-white peer-checked:[background:var(--c)] peer-focus-visible:ring-2 peer-focus-visible:ring-tinta/40"
                style={{ "--c": r.color } as React.CSSProperties}
              >
                <span className="h-2 w-2 rounded-full bg-[var(--c)] [input:checked+span>&]:bg-white" aria-hidden="true" />
                {r.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
