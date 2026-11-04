import { notFound } from "next/navigation";
import { AccionRapida, FormularioAccion } from "@/components/formulario-accion";
import { Cabecera, Campo, Selector, Tarjeta, Vacio, euro, numero } from "@/components/ui";
import { getRestaurante } from "@/lib/contexto";
import { cargarIngredientes } from "@/lib/datos";
import { archivar } from "../../actions";
import { crearProducto, crearProveedor } from "../actions";

export const metadata = { title: "Proveedores" };

export default async function Proveedores({ params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const r = await getRestaurante(rid);
  if (!r) notFound();
  const { ctx, restaurante } = r;
  const sb = ctx.supabase;
  const [{ data: proveedores }, { data: productos }, ings] = await Promise.all([
    sb.from("suppliers").select("id, name, tax_id, contact, phone, email, version").eq("restaurant_id", rid).eq("status", "active").order("name"),
    sb.from("supplier_products").select("id, supplier_id, ingredient_id, description, brand, reference, pack_quantity, pack_unit, last_price, last_price_date, version").eq("restaurant_id", rid).eq("status", "active").order("description"),
    cargarIngredientes(sb, rid, restaurante.organization_id),
  ]);
  const ing = new Map(ings.map((i) => [i.id, i.name]));
  const puede = ctx.puede(restaurante, "precios");

  return (
    <>
      <Cabecera
        titulo="Proveedores y productos"
        subtitulo="Separa la materia prima (aceite de oliva) del producto que vende cada proveedor (garrafa de 5 l de una marca). Los proveedores no se fusionan automáticamente por parecido de nombre."
      />
      {puede && (
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <Tarjeta>
            <h2 className="text-[17px] font-semibold">Nuevo proveedor</h2>
            <FormularioAccion action={crearProveedor} boton="Guardar proveedor" className="mt-4">
              <input type="hidden" name="rid" value={rid} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Nombre" name="name" required className="sm:col-span-2" />
                <Campo label="CIF / NIF" name="tax_id" />
                <Campo label="Contacto" name="contact" />
                <Campo label="Teléfono" name="phone" type="tel" />
                <Campo label="Email" name="email" type="email" />
              </div>
            </FormularioAccion>
          </Tarjeta>
          {(proveedores?.length ?? 0) > 0 && (
            <Tarjeta>
              <h2 className="text-[17px] font-semibold">Nuevo producto de proveedor</h2>
              <FormularioAccion action={crearProducto} boton="Guardar producto" className="mt-4">
                <input type="hidden" name="rid" value={rid} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Selector label="Proveedor" name="supplier_id">{proveedores!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Selector>
                  <Selector label="Materia prima" name="ingredient_id">{ings.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Selector>
                  <Campo label="Formato" name="description" required placeholder="Garrafa 5 l" />
                  <Campo label="Marca" name="brand" />
                  <Campo label="Contenido por envase" name="pack_quantity" inputMode="decimal" required />
                  <Selector label="Unidad" name="pack_unit" defaultValue="kg">
                    <option value="kg">kg</option><option value="g">g</option><option value="l">l</option><option value="ml">ml</option><option value="unit">ud</option>
                  </Selector>
                  <Campo label="Referencia" name="reference" />
                  <Campo label="Precio por envase (sin IVA)" name="last_price" inputMode="decimal" unidad="€" ayuda="Orientativo; el precio real llega con cada factura." />
                </div>
              </FormularioAccion>
            </Tarjeta>
          )}
        </div>
      )}

      {(proveedores?.length ?? 0) === 0 ? (
        <Vacio titulo="Sin proveedores" texto="Crea tus proveedores para registrar sus facturas." />
      ) : (
        <ul className="space-y-4">
          {proveedores!.map((p) => {
            const prods = (productos ?? []).filter((x) => x.supplier_id === p.id);
            return (
              <li key={p.id} className="rounded-[22px] bg-white ring-1 ring-linea">
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <div>
                    <p className="text-[16px] font-semibold">{p.name}</p>
                    <p className="text-[13px] text-niebla">{[p.tax_id, p.contact, p.phone, p.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
                  </div>
                  {puede && <AccionRapida action={archivar} etiqueta="Archivar" campos={{ restaurant_id: rid, tabla: "suppliers", id: p.id, version: p.version, ruta: "/compras/proveedores" }} />}
                </div>
                {prods.length > 0 && (
                  <ul className="divide-y divide-linea/70 border-t border-linea">
                    {prods.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-[14px]">
                        <span>
                          <span className="font-medium">{x.description}</span>
                          <span className="text-niebla"> · {[x.brand, `${numero(x.pack_quantity)} ${x.pack_unit}`, ing.get(x.ingredient_id)].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="tabular-nums text-grafito">{x.last_price ? `${euro(x.last_price)}${x.last_price_date ? ` · ${new Date(x.last_price_date).toLocaleDateString("es-ES")}` : ""}` : "—"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
