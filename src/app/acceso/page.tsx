import type { Metadata } from "next";
import { Marca } from "@/components/marca";
import { Mundo } from "@/components/mundo";
import { FormularioAcceso } from "./formulario";

export const metadata: Metadata = { title: "Acceder" };

export default async function Acceso({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="flex min-h-screen flex-col bg-crema">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center px-6">
        <Marca />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-sm">
          <div className="mx-auto flex w-fit -space-x-3" aria-hidden="true">
            <Mundo id="jindama" size={40} />
            <Mundo id="jaleo" size={40} />
            <Mundo id="juye" size={40} />
          </div>
          <h1 className="mt-8 text-center text-[32px] font-semibold tracking-[-0.03em]">Acceder al universo</h1>
          <p className="mt-2 text-center text-[15px] text-niebla">Entra con tu usuario y contraseña.</p>
          <FormularioAcceso next={next} errorInicial={error === "enlace" ? "El enlace no es válido o ha caducado." : undefined} />
        </div>
      </main>
    </div>
  );
}
