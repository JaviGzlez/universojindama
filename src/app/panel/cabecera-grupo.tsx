import Link from "next/link";
import { salir } from "@/app/acceso/actions";
import { Marca } from "@/components/marca";
import type { Contexto } from "@/lib/contexto";

/** Barra superior de las páginas de grupo: Universo, Tareas y Administración. */
export async function CabeceraGrupo({ ctx, activo }: { ctx: Contexto; activo: "universo" | "tareas" | "administracion" }) {
  const org = ctx.restaurants[0]?.organization_id;
  const propietario = org ? ctx.esPropietario(org) : false;
  const { count } = await ctx.supabase.from("tasks").select("id", { count: "exact", head: true })
    .eq("assignee_id", ctx.user.id).neq("status", "done");
  const enlace = (id: typeof activo) =>
    `rounded-full px-3 py-1.5 font-medium transition ${activo === id ? "bg-tinta text-crema" : "text-tinta hover:bg-tinta/5"}`;

  return (
    <header className="sticky top-0 z-40 border-b border-linea/60 bg-crema/75 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-5 md:px-8" aria-label="Grupo">
        <Marca href="/panel" />
        <div className="flex items-center gap-1 text-[13px]">
          <Link href="/panel" className={`${enlace("universo")} hidden sm:inline-flex`}>Universo</Link>
          <Link href="/panel/tareas" className={`${enlace("tareas")} inline-flex items-center gap-1.5`}>
            Tareas
            {!!count && (
              <span className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold ${activo === "tareas" ? "bg-crema text-tinta" : "bg-terracota text-white"}`}
                aria-label={`${count} asignadas a ti`}>{count}</span>
            )}
          </Link>
          {propietario && <Link href="/panel/administracion" className={enlace("administracion")}>Administración</Link>}
          <form action={salir}>
            <button className="rounded-full px-3 py-1.5 text-grafito hover:bg-tinta/5">Salir</button>
          </form>
        </div>
      </nav>
    </header>
  );
}
