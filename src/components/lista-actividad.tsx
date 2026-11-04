import { Avatar } from "@/components/avatar";
import { diaDe, haceCuanto, horaDe, type Actividad } from "@/lib/actividad";

const PUNTO: Record<Actividad["tipo"], string> = {
  crear: "bg-musgo",
  cambiar: "bg-ambar",
  archivar: "bg-niebla",
  acceso: "bg-tinta",
  precio: "bg-terracota",
};

export function ListaActividad({ items, tz, agruparPorDia = true, mostrarRestaurante = true }: {
  items: Actividad[];
  tz: string;
  agruparPorDia?: boolean;
  mostrarRestaurante?: boolean;
}) {
  const grupos: { dia: string; items: Actividad[] }[] = [];
  for (const it of items) {
    const dia = agruparPorDia ? diaDe(it.cuando, tz) : "";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.items.push(it);
    else grupos.push({ dia, items: [it] });
  }

  return (
    <div className="space-y-8">
      {grupos.map((g) => (
        <section key={g.dia || "todo"}>
          {g.dia && <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.1em] text-niebla first-letter:uppercase">{g.dia}</h2>}
          <ol className="divide-y divide-linea/70 rounded-[22px] bg-white ring-1 ring-linea">
            {g.items.map((it) => (
              <li key={it.id} className="flex gap-4 px-5 py-4 md:px-6">
                <div className="relative">
                  <Avatar nombre={it.quien} size={36} />
                  <span aria-hidden="true" className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${PUNTO[it.tipo]}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug">
                    <span className="font-semibold">{it.quien}</span> {it.texto}
                  </p>
                  <p className="mt-0.5 text-[13px] text-niebla">
                    {[it.detalle, mostrarRestaurante ? it.restaurante ?? "Grupo" : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <time dateTime={it.cuando} className="shrink-0 pt-0.5 text-[12px] tabular-nums text-niebla" title={new Date(it.cuando).toLocaleString("es-ES", { timeZone: tz })}>
                  {haceCuanto(it.cuando) ?? horaDe(it.cuando, tz)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
