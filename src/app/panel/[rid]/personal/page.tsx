import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Tabla, Tarjeta, Vacio, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarPerfiles } from "@/lib/datos";
import { archivar, crearPerfil } from "../actions";

export const metadata = { title: "Personal" };

export default async function Personal({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const perfiles = await cargarPerfiles(ctx.supabase, rid);
  const puede = ctx.puede(restaurante, "personal");

  return (
    <>
      <Cabecera
        titulo="Perfiles de personal"
        subtitulo="Coste por hora productiva = coste total del periodo para la empresa ÷ horas productivas. No hace falta guardar datos personales."
      />
      {puede && (
        <Tarjeta className="mb-8">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Nuevo perfil</h2>
          <p className="mt-1 text-[14px] text-niebla">Usa el coste para la empresa (bruto, seguridad social, pagas prorrateadas…), nunca el salario neto.</p>
          <FormularioAccion action={crearPerfil} boton="Guardar perfil" className="mt-6">
            <input type="hidden" name="restaurant_id" value={rid} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Perfil" name="name" required placeholder="Cocinero" />
              <Campo label="Periodo" name="period_label" defaultValue="mensual" required />
              <Campo label="Coste total empresa del periodo" name="period_cost" inputMode="decimal" unidad="€" required />
              <Campo label="Horas productivas del periodo" name="productive_hours" inputMode="decimal" unidad="h" required ayuda="Sin vacaciones, ausencias ni descansos." />
              <Campo label="Qué incluye el coste" name="includes" className="sm:col-span-2 lg:col-span-4" placeholder="Bruto + SS empresa + prorrata de pagas" />
            </div>
          </FormularioAccion>
        </Tarjeta>
      )}
      {perfiles.length === 0 ? (
        <Vacio titulo="Aún no hay perfiles" texto="Crea perfiles como cocinero, ayudante o preparación para imputar minutos de trabajo a cada plato." />
      ) : (
        <Tabla cabeceras={["Perfil", "Coste del periodo", "Horas productivas", "Coste por hora", "Incluye", ""]}>
          {perfiles.map((p) => (
            <tr key={p.id}>
              <td className="px-5 py-4 font-medium">{p.name}</td>
              <td className="px-5 py-4 tabular-nums">{euro(p.period_cost)} <span className="text-[12px] text-niebla">{p.period_label}</span></td>
              <td className="px-5 py-4 tabular-nums">{numero(p.productive_hours)} h</td>
              <td className="px-5 py-4 font-medium tabular-nums">{euro(p.cost_per_hour, 2)}/h</td>
              <td className="px-5 py-4 text-[13px] text-grafito">{p.includes ?? "—"}</td>
              <td className="px-5 py-4 text-right">
                {puede && (
                  <AccionRapida action={archivar} etiqueta="Archivar"
                    campos={{ restaurant_id: rid, tabla: "labor_profiles", id: p.id, version: p.version, ruta: "/personal" }} />
                )}
              </td>
            </tr>
          ))}
        </Tabla>
      )}
    </>
  );
}
