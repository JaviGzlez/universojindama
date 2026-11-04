import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Marca } from "@/components/marca";
import { getContexto } from "@/lib/contexto";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { salir } from "@/app/acceso/actions";

export const metadata: Metadata = { title: "Panel" };
export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <Aviso titulo="Falta configurar Supabase">
        Añade <code>NEXT_PUBLIC_SUPABASE_URL</code> y <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> en las variables de
        entorno de Vercel (o en <code>.env.local</code>) y vuelve a desplegar.
      </Aviso>
    );
  }
  const ctx = await getContexto();
  if (!ctx) redirect("/acceso?next=/panel");

  if (ctx.restaurants.length === 0) {
    return (
      <Aviso titulo="Tu cuenta aún no tiene acceso">
        <p>
          Has entrado como <strong>{ctx.user.email}</strong>, pero todavía no tienes acceso a ningún restaurante. Pídeselo al administrador del grupo.
        </p>
        <p className="mt-4">
          Si eres el primer propietario, abre el editor SQL de Supabase y ejecuta:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-tinta p-4 text-left text-[13px] text-crema">
          {`select public.grant_owner('${ctx.user.email}', 'grupo-jindama');`}
        </pre>
        <form action={salir} className="mt-8">
          <button className="text-[14px] font-medium text-tinta underline-offset-4 hover:underline">Cerrar sesión</button>
        </form>
      </Aviso>
    );
  }
  return <>{children}</>;
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-crema">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center px-6"><Marca /></header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 pb-24">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em]">{titulo}</h1>
        <div className="mt-4 text-[15px] leading-relaxed text-grafito">{children}</div>
      </main>
    </div>
  );
}
