import { Campo, Selector, claseInput } from "@/components/ui";
import { NOMBRE_ESTADO, NOMBRE_PRIORIDAD, ESTADOS, PRIORIDADES, type Persona, type Tarea } from "@/lib/tareas";

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
  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <Campo label="Qué hay que hacer" name="title" required maxLength={200} defaultValue={tarea?.title}
          placeholder="Revisar alérgenos de la carta de otoño" className="md:col-span-4" />
        <label className="block md:col-span-4">
          <span className="mb-1.5 block text-[13px] font-medium text-grafito">Detalles <span className="font-normal text-niebla">(opcional)</span></span>
          <textarea name="description" rows={3} maxLength={4000} defaultValue={tarea?.description ?? ""}
            placeholder="Pasos, enlaces, qué se considera terminado…" className={`${claseInput} h-auto py-2.5 leading-relaxed`} />
        </label>
        <Selector label="Responsable" name="assignee_id" defaultValue={tarea ? tarea.assignee_id ?? "" : ""}
          ayuda="Sin asignar: cualquiera del equipo puede quedársela.">
          <option value="">Sin asignar</option>
          {personas.map((p) => (
            <option key={p.user_id} value={p.user_id}>{p.display_name}{p.user_id === yo ? " (yo)" : ""}</option>
          ))}
        </Selector>
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
