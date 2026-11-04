import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAccion } from "@/components/formulario-accion";
import { Mundo, mundoDeSlug } from "@/components/mundo";
import { Insignia, Selector, Tabla, Tarjeta, euro } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import type { BloqueResumen } from "@/lib/importar/analitica";
import { aplicarImportacion, deshacerImportacion } from "../../actions";

export const metadata = { title: "Revisar importación" };

export default async function RevisarImportacion({ params }: { params: Promise<{ rid: string; job: string }> }) {
  const { rid, job } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const { data: j } = await sb.from("import_jobs").select("id, file_name, year, status, summary, mapping, rows_total, rows_error, created_at, applied_at").eq("id", job).maybeSingle();
  if (!j) notFound();
  const { data: errores } = await sb.from("import_rows").select("sheet, cell, original, error").eq("job_id", job).eq("status", "error").limit(100);
  const resumen = j.summary as { bloques: BloqueResumen[]; avisos: string[] };
  const restaurantes = ctx.restaurants.filter((x) => x.organization_id === restaurante.organization_id);
  const porSlug = (s: string | null) => restaurantes.find((x) => s && mundoDeSlug(x.slug) === s)?.id ?? "";
  const mapping = (j.mapping ?? {}) as Record<string, string | null>;

  return (
    <>
      <Link href={`/panel/${rid}/economia/importar`} className="text-[13px] font-medium text-niebla hover:text-tinta">← Importaciones</Link>
      <div className="mb-8 mt-3">
        <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-niebla">Año {j.year} · {j.rows_total} importes leídos{j.rows_error ? ` · ${j.rows_error} con error` : ""}</p>
        <h1 className="mt-1 text-[32px] font-semibold tracking-[-0.03em] md:text-[40px]">{j.file_name}</h1>
      </div>

      {j.status === "applied" && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl bg-musgo-claro px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] text-musgo">Aplicada el {new Date(j.applied_at!).toLocaleString("es-ES", { timeZone: restaurante.timezone })}. Ya aparece en Resultados y en la portada.</p>
          <FormularioAccion action={deshacerImportacion} boton="Deshacer importación" limpiar={false} className="[&>div]:mt-0">
            <input type="hidden" name="rid" value={rid} /><input type="hidden" name="job" value={job} />
          </FormularioAccion>
        </div>
      )}

      <div>
        <div className="grid gap-5 lg:grid-cols-3">
          {resumen.bloques.map((b) => {
            const sugerido = mapping[String(b.block)] ?? porSlug(b.sugerido);
            return (
              <Tarjeta key={b.block}>
                <div className="flex items-center gap-3">
                  {b.sugerido && <Mundo id={b.sugerido} size={40} />}
                  <div>
                    <p className="text-[13px] text-niebla">Bloque {b.block}</p>
                    <p className="text-[15px] font-semibold">{b.titulos[0]?.split(": ")[1] ?? "Sin título"}</p>
                  </div>
                </div>
                <p className="mt-3 text-[13px] text-niebla">{b.meses.length ? `Meses con datos: ${b.meses.join(", ")}` : "Sin datos"}</p>
                <dl className="mt-4 space-y-1.5 text-[14px]">
                  <div className="flex justify-between"><dt className="text-grafito">Ingresos</dt><dd className="tabular-nums">{euro(b.totales.revenue, 0)}</dd></div>
                  <div className="flex justify-between"><dt className="text-grafito">Compras</dt><dd className="tabular-nums">{euro(b.totales.purchase, 0)}</dd></div>
                  <div className="flex justify-between"><dt className="text-grafito">Personal</dt><dd className="tabular-nums">{euro(b.totales.labor, 0)}</dd></div>
                  <div className="flex justify-between"><dt className="text-grafito">Gastos operativos</dt><dd className="tabular-nums">{euro(b.totales.expense, 0)}</dd></div>
                </dl>
                {b.avisos.length > 0 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-[13px] font-medium text-ambar">▲ {b.avisos.length} {b.avisos.length === 1 ? "aviso" : "avisos"} para revisar</summary>
                    <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-grafito">{b.avisos.map((a, i) => <li key={i}>· {a}</li>)}</ul>
                  </details>
                )}
                {j.status === "preview" ? (
                  <div className="mt-4">
                    <Selector label="Importar en" name={`bloque_${b.block}`} defaultValue={sugerido} form="aplicar">
                      <option value="">No importar este bloque</option>
                      {restaurantes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </Selector>
                  </div>
                ) : (
                  <p className="mt-4 text-[13px]">→ <strong>{restaurantes.find((x) => x.id === mapping[String(b.block)])?.name ?? "No importado"}</strong></p>
                )}
              </Tarjeta>
            );
          })}
        </div>
      </div>

      {j.status === "preview" && (
        <div className="mt-6 flex flex-col gap-3 rounded-[22px] bg-white p-5 ring-1 ring-linea sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-[13px] text-niebla">
            Al aplicar se sustituyen los importes importados antes desde Excel en esos restaurantes y meses. Las celdas con error no se importan.
            Es una operación única: si algo falla, no se aplica nada.
          </p>
          <FormularioAccion id="aplicar" action={aplicarImportacion} boton="Aplicar importación" limpiar={false} className="[&>div]:mt-0">
            <input type="hidden" name="rid" value={rid} /><input type="hidden" name="job" value={job} />
          </FormularioAccion>
        </div>
      )}

      {(errores?.length ?? 0) > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-[20px] font-semibold">Celdas con error <Insignia tono="pendiente">{j.rows_error}</Insignia></h2>
          <p className="mb-3 text-[13px] text-niebla">No se importan. Corrígelas en el Excel y vuelve a subirlo si quieres incluirlas.</p>
          <Tabla cabeceras={["Hoja", "Celda", "Valor", "Problema"]}>
            {errores!.map((e, i) => (
              <tr key={i}>
                <td className="px-5 py-2.5">{e.sheet}</td>
                <td className="px-5 py-2.5 font-mono text-[13px]">{e.cell}</td>
                <td className="px-5 py-2.5 font-mono text-[13px] text-grafito">{e.original ?? ""}</td>
                <td className="px-5 py-2.5 text-grafito">{e.error}</td>
              </tr>
            ))}
          </Tabla>
        </section>
      )}
    </>
  );
}
