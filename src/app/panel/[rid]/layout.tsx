import { notFound } from "next/navigation";
import { Marca } from "@/components/marca";
import { mundoDeSlug } from "@/components/mundo";
import { AREAS, getContexto, NOMBRE_ROL } from "@/lib/contexto";
import { salir } from "@/app/acceso/actions";
import { Navegacion, SelectorRestaurante } from "./navegacion";

export default async function RestauranteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const ctx = await getContexto();
  const restaurante = ctx?.restaurants.find((r) => r.id === rid);
  if (!ctx || !restaurante) notFound();
  const roles = ctx.roles(restaurante).map((r) => NOMBRE_ROL[r]);
  const color = COLOR_MENU[mundoDeSlug(restaurante.slug)];
  const puedeVer = AREAS.filter((a) => ctx.puedeVer(restaurante, a));
  const propietario = ctx.esPropietario(restaurante.organization_id);

  return (
    <div className="min-h-screen bg-crema lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="border-b border-linea bg-white/70 backdrop-blur-xl lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between px-5">
            <Marca href="/panel" />
          </div>
          <div className="px-4 pb-4">
            <SelectorRestaurante actual={rid} restaurantes={ctx.restaurants.map((r) => ({ id: r.id, name: r.name, slug: r.slug }))} />
          </div>
          <div className="mx-4 mb-4 h-1 rounded-full" style={{ background: color }} aria-hidden="true" />
          <Navegacion rid={rid} color={color} puedeVer={puedeVer} propietario={propietario} />
          <div className="mt-auto hidden border-t border-linea px-5 py-4 lg:block">
            <p className="truncate text-[13px] font-medium">{ctx.nombre}</p>
            <p className="text-[12px] text-niebla">{roles.join(" · ") || "Sin rol"}</p>
            <form action={salir} className="mt-2">
              <button className="text-[12px] font-medium text-niebla hover:text-tinta">Cerrar sesión</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-5 py-8 md:px-10 md:py-12">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

/** Color de cada universo para el menú (contraste suficiente sobre blanco). */
const COLOR_MENU = { jindama: "#4f6b4a", jaleo: "#b0532f", juye: "#8a5a1c" } as const;
