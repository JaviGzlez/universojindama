import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Insignia, Tabla, Tarjeta, SinPermiso } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { subirExcel } from "../actions";

export const metadata = { title: "Importar Excel" };

const ESTADO = { preview: ["Pendiente de revisar", "estimado"], applied: ["Aplicada", "ok"], reverted: ["Deshecha", "neutro"], failed: ["Fallida", "pendiente"] } as const;

export default async function Importar({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  if (!ctx.puedeVer(restaurante, "economia")) return <SinPermiso apartado="economía" />;
  const { data: jobs } = await ctx.supabase.from("import_jobs")
    .select("id, file_name, year, status, rows_total, rows_error, created_at, applied_at")
    .eq("organization_id", restaurante.organization_id).order("created_at", { ascending: false }).limit(20);
  const puede = ctx.esPropietario(restaurante.organization_id) || ctx.roles(restaurante).some((x) => x === "admin" || x === "accounting");

  return (
    <>
      <Cabecera
        titulo="Importar Excel de analítica"
        subtitulo="Sube «ANALITICA <año> JINDAMA JALEO». Antes de aplicar nada verás qué se ha leído de cada bloque, los avisos y los errores, y elegirás a qué restaurante corresponde cada bloque."
      />
      {puede ? (
        <Tarjeta className="mb-8">
          <FormularioAccion action={subirExcel} boton="Leer el archivo">
            <input type="hidden" name="rid" value={rid} />
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-grafito">Archivo .xlsx</span>
                <input type="file" name="archivo" accept=".xlsx" required className="block w-full text-[14px] file:mr-3 file:rounded-full file:border-0 file:bg-crema-2 file:px-4 file:py-2.5 file:text-[13px] file:font-medium" />
              </label>
              <Campo label="Año" name="anio" type="number" defaultValue={new Date().getFullYear()} ayuda="Se detecta del nombre si lo lleva." />
            </div>
          </FormularioAccion>
          <ul className="mt-6 space-y-1.5 text-[13px] leading-relaxed text-niebla">
            <li>· Se importan las hojas ENERO…DICIEMBRE: compras por proveedor y día, ingresos por canal y día, gastos fijos y variables, y personal.</li>
            <li>· Del personal solo se guardan los totales del mes (sueldos, Seguridad Social, IRPF). <strong className="font-medium text-grafito">Nunca nombres ni sueldos individuales.</strong></li>
            <li>· Préstamos e inversiones se guardan aparte: no cuentan como gasto operativo.</li>
            <li>· La hoja GENERAL no se importa: son resúmenes calculados de las demás.</li>
            <li>· Volver a importar un Excel actualizado sustituye lo importado antes en esos meses, sin duplicar. Los periodos cerrados no se tocan.</li>
          </ul>
        </Tarjeta>
      ) : (
        <p className="mb-8 rounded-2xl bg-ambar-claro px-5 py-4 text-[14px] text-ambar">Solo el propietario, un administrador o administración de todo el grupo pueden importar.</p>
      )}

      {(jobs?.length ?? 0) > 0 && (
        <Tabla cabeceras={["Fecha", "Archivo", "Año", "Filas", "Estado"]}>
          {jobs!.map((j) => {
            const e = ESTADO[j.status as keyof typeof ESTADO];
            return (
              <tr key={j.id}>
                <td className="px-5 py-3 text-grafito">{new Date(j.created_at).toLocaleString("es-ES", { timeZone: restaurante.timezone, dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-5 py-3"><Link href={`/panel/${rid}/economia/importar/${j.id}`} className="font-medium text-musgo hover:underline">{j.file_name}</Link></td>
                <td className="px-5 py-3">{j.year}</td>
                <td className="px-5 py-3 tabular-nums">{j.rows_total}{j.rows_error ? <span className="text-terracota"> · {j.rows_error} errores</span> : ""}</td>
                <td className="px-5 py-3"><Insignia tono={e[1]}>{e[0]}</Insignia></td>
              </tr>
            );
          })}
        </Tabla>
      )}
    </>
  );
}
