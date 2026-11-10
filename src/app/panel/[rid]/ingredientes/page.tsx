import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, CasillasAlergenos, Campo, Insignia, Selector, Tabla, Tarjeta, Vacio, euro, numero } from "@/components/ui";
import Link from "next/link";
import { getRestaurante } from "@/lib/contexto";
import { cargarIngredientes } from "@/lib/datos";
import { archivar, crearIngrediente, registrarPrecio } from "../actions";

export const metadata = { title: "Materias primas" };

const UNIDAD = { g: "g", ml: "ml", unit: "ud" } as const;
const REFERENCIA = { g: { f: 1000, u: "kg" }, ml: { f: 1000, u: "l" }, unit: { f: 1, u: "ud" } } as const;

export default async function Ingredientes({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const ingredientes = await cargarIngredientes(ctx.supabase, rid, restaurante.organization_id);
  const puedeCrear = ctx.puede(restaurante, "materias");
  const puedePrecio = ctx.puede(restaurante, "materias") || ctx.puede(restaurante, "compras");
  const propietario = ctx.esPropietario(restaurante.organization_id);

  return (
    <>
      <Cabecera
        titulo="Materias primas"
        subtitulo={`Ingredientes de ${restaurante.name} y del catálogo compartido. Cada restaurante guarda sus propios precios, con histórico. Abre una materia prima para ver su evolución de precio, proveedores, recetas que la usan, existencias y mermas.`}
      />

      {puedeCrear && (
        <Tarjeta className="mb-8">
          <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Nueva materia prima</h2>
          <p className="mt-1 text-[14px] text-niebla">El rendimiento es la parte aprovechable tras limpiar o pelar. El precio se añade después.</p>
          <FormularioAccion action={crearIngrediente} boton="Guardar materia prima" className="mt-6">
            <input type="hidden" name="restaurant_id" value={rid} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Nombre" name="name" required placeholder="Aceite de oliva virgen extra" className="sm:col-span-2" />
              <Campo label="Categoría" name="category" placeholder="Aceites" />
              <Selector label="Unidad base" name="base_unit" defaultValue="g">
                <option value="g">Gramos (g)</option>
                <option value="ml">Mililitros (ml)</option>
                <option value="unit">Unidades</option>
              </Selector>
              <Campo label="Rendimiento aprovechable" name="yield_pct" defaultValue="100" inputMode="decimal" unidad="%" required />
              <Campo label="Densidad" name="density" inputMode="decimal" unidad="g/ml" ayuda="Solo si conviertes entre peso y volumen." />
              <Campo label="Peso por unidad" name="unit_weight_g" inputMode="decimal" unidad="g" ayuda="Solo si usas unidades." />
              <Campo label="Volumen por unidad" name="unit_volume_ml" inputMode="decimal" unidad="ml" />
              <Campo label="Fuente del dato" name="source" placeholder="Ficha técnica, medición propia…" />
              <Selector label="Ámbito" name="scope" defaultValue="local">
                <option value="local">Solo {restaurante.name}</option>
                {propietario && <option value="shared">Compartido con el grupo</option>}
              </Selector>
            </div>
            <CasillasAlergenos className="mt-5" />
          </FormularioAccion>
        </Tarjeta>
      )}

      {ingredientes.length === 0 ? (
        <Vacio titulo="Aún no hay materias primas" texto="Crea la primera para poder usarla en un escandallo." />
      ) : (
        <Tabla cabeceras={["Materia prima", "Unidad", "Rendimiento", "Precio vigente", "Alérgenos", ""]}>
          {ingredientes.map((i) => {
            const ref = REFERENCIA[i.base_unit];
            const porRef = i.precio ? Number(i.precio.price_per_base_unit) * ref.f : null;
            return (
              <tr key={i.id} className="align-top">
                <td className="px-5 py-4">
                  <Link href={`/panel/${rid}/ingredientes/${i.id}`} className="font-medium text-tinta hover:text-musgo hover:underline">{i.name}</Link>
                  <p className="text-[12px] text-niebla">
                    {i.category ?? "Sin categoría"}
                    {i.restaurant_id === null && " · compartido"}
                  </p>
                </td>
                <td className="px-5 py-4 text-grafito">{UNIDAD[i.base_unit]}</td>
                <td className="px-5 py-4 text-grafito">{numero(Number(i.yield_ratio) * 100, 2)} %</td>
                <td className="px-5 py-4">
                  {i.precio ? (
                    <>
                      <p className="font-medium tabular-nums">{euro(porRef, 2)} / {ref.u}</p>
                      <p className="text-[12px] text-niebla">desde {new Date(i.precio.valid_from).toLocaleDateString("es-ES")}</p>
                    </>
                  ) : (
                    <Insignia tono="pendiente">Sin precio</Insignia>
                  )}
                  {puedePrecio && (
                    <details className="mt-2 group">
                      <summary className="cursor-pointer list-none text-[13px] font-medium text-musgo hover:underline">
                        {i.precio ? "Actualizar precio" : "Añadir precio"}
                      </summary>
                      <FormularioAccion action={registrarPrecio} boton="Registrar precio" className="mt-3 w-[280px]">
                        <input type="hidden" name="restaurant_id" value={rid} />
                        <input type="hidden" name="ingredient_id" value={i.id} />
                        <div className="grid grid-cols-2 gap-3">
                          <Campo label="Precio sin IVA" name="importe" inputMode="decimal" unidad="€" required className="col-span-2" />
                          <Campo label="Por cantidad" name="cantidad" inputMode="decimal" defaultValue="1" required />
                          <Selector label="Unidad" name="unidad" defaultValue={i.base_unit === "unit" ? "unit" : i.base_unit === "g" ? "kg" : "l"}>
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                            <option value="l">l</option>
                            <option value="ml">ml</option>
                            <option value="unit">ud</option>
                          </Selector>
                        </div>
                      </FormularioAccion>
                    </details>
                  )}
                </td>
                <td className="px-5 py-4 text-[13px] text-grafito">{i.allergens.length ? i.allergens.join(", ") : "—"}</td>
                <td className="px-5 py-4 text-right">
                  {puedeCrear && (i.restaurant_id !== null || propietario) && (
                    <AccionRapida
                      action={archivar} etiqueta="Archivar" confirmar={`¿Archivar «${i.name}»? Se conserva el histórico.`}
                      campos={{ restaurant_id: rid, tabla: "ingredients", id: i.id, version: i.version, ruta: "/ingredientes" }}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </Tabla>
      )}
    </>
  );
}
