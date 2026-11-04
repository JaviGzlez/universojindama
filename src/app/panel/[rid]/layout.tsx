import { notFound } from "next/navigation";
import { Marca } from "@/components/marca";
import { getContexto, NOMBRE_ROL } from "@/lib/contexto";
import { salir } from "@/app/acceso/actions";
import { Navegacion, SelectorRestaurante } from "./navegacion";

export default async function RestauranteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const ctx = await getContexto();
  const restaurante = ctx?.restaurants.find((r) => r.id === rid);
  if (!ctx || !restaurante) notFound();
  const roles = ctx.roles(restaurante).map((r) => NOMBRE_ROL[r]);

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
          <Navegacion rid={rid} />
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
