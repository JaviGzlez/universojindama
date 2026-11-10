"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Insignia, claseInput, euro, numero } from "@/components/ui";
import type { QuantityUnit } from "@/lib/engine";
import { ALERGENOS, alergenosDe, calcularDesdeCatalogo, type CatalogoPlano, type VersionEditable } from "@/lib/recetas-entrada";
import { Bloque, Fila, Num, Resultado, Sel } from "../../escandallo/calculadora";
import { activarVersion, crearMateriaRapida, descartarBorrador, guardarBorrador, guardarComoReceta, nuevaVersion } from "../actions";

type LineaIng = VersionEditable["ingredientes"][number] & { key: number };
type LineaEq = VersionEditable["equipos"][number] & { key: number };
type LineaLab = VersionEditable["personal"][number] & { key: number };
type LineaCon = VersionEditable["consumibles"][number] & { key: number };
interface Paso { key: number; title: string; description: string; minutes: string; temperature_c: string; equipment_id: string | null; is_critical: boolean }

function sinClave<T extends { key: number }>(l: T): Omit<T, "key"> {
  const copia: Partial<T> = { ...l };
  delete copia.key;
  return copia as Omit<T, "key">;
}

let n = 0;
const k = () => ++n;
const pctTexto = (v: string) => String(Math.round(Number(v) * 10000) / 100);
const pctValor = (v: string) => (v.trim() === "" ? "1" : String(Number(v.replace(",", ".")) / 100));

export interface PropsEditor {
  rid: string;
  recipeId: string;
  kind: "dish" | "preparation";
  version: {
    id: string; number: number; status: "draft" | "active" | "superseded"; version: number;
    portions: string | null; yield_quantity: string | null; yield_unit: "g" | "ml" | "unit" | null;
    labor_is_variable: boolean; use_overheads: boolean; steps: string | null; notes: string | null;
    ingredientes: VersionEditable["ingredientes"]; equipos: VersionEditable["equipos"]; personal: VersionEditable["personal"]; consumibles: VersionEditable["consumibles"];
    prep_minutes: string | null; cook_minutes: string | null; rest_minutes: string | null; shelf_life_hours: string | null;
    storage: string | null; serving: string | null; portion_size: string | null; extra_allergens: string[];
    pasos: { title: string | null; description: string; minutes: string | null; temperature_c: string | null; equipment_id: string | null; is_critical: boolean }[];
  };
  hayActiva: boolean;
  puedeEditar: boolean;
  /** «libre» = escandallo rápido: sin versión, todo abierto y con «Guardar como receta» */
  modo?: "receta" | "libre";
  puedeCrearMaterias?: boolean;
  catalogo: CatalogoPlano;
  impuestosVenta: { id: string; name: string; rate: string }[];
  decimales: number;
}

export function EditorReceta(p: PropsEditor) {
  const router = useRouter();
  const v = p.version;
  const libre = p.modo === "libre";
  const editable = libre || (p.puedeEditar && v.status === "draft");
  const [cat, setCat] = useState<CatalogoPlano>(p.catalogo);
  const [kind, setKind] = useState<"dish" | "preparation">(p.kind);
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [portions, setPortions] = useState(v.portions ?? "");
  const [yieldQ, setYieldQ] = useState(v.yield_quantity ?? "");
  const [yieldU, setYieldU] = useState<"g" | "ml" | "unit">(v.yield_unit ?? "g");
  const [laborVar, setLaborVar] = useState(v.labor_is_variable);
  const [useOver, setUseOver] = useState(v.use_overheads);
  const [steps, setSteps] = useState(v.steps ?? "");
  const [notes, setNotes] = useState(v.notes ?? "");
  const [ings, setIngs] = useState<LineaIng[]>(v.ingredientes.map((l) => ({ ...l, key: k() })));
  const [eqs, setEqs] = useState<LineaEq[]>(v.equipos.map((l) => ({ ...l, key: k() })));
  const [labs, setLabs] = useState<LineaLab[]>(v.personal.map((l) => ({ ...l, key: k() })));
  const [cons, setCons] = useState<LineaCon[]>(v.consumibles.map((l) => ({ ...l, key: k() })));
  const [prep, setPrep] = useState(v.prep_minutes ?? "");
  const [cook, setCook] = useState(v.cook_minutes ?? "");
  const [rest, setRest] = useState(v.rest_minutes ?? "");
  const [vida, setVida] = useState(v.shelf_life_hours ?? "");
  const [storage, setStorage] = useState(v.storage ?? "");
  const [serving, setServing] = useState(v.serving ?? "");
  const [portionSize, setPortionSize] = useState(v.portion_size ?? "");
  const [extraAl, setExtraAl] = useState<string[]>(v.extra_allergens ?? []);
  const [pasos, setPasos] = useState<Paso[]>(v.pasos.map((x) => ({
    key: k(), title: x.title ?? "", description: x.description, minutes: x.minutes ?? "", temperature_c: x.temperature_c ?? "", equipment_id: x.equipment_id, is_critical: x.is_critical,
  })));
  const [tab, setTab] = useState<"composicion" | "proceso" | "conservacion">("composicion");
  const [pvp, setPvp] = useState("");
  const [imp, setImp] = useState(p.impuestosVenta[0]?.id ?? "");
  const [sucio, setSucio] = useState(false);
  const [estado, setEstado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, start] = useTransition();
  const [versionActual, setVersionActual] = useState(v.version);
  const marcar = <T,>(f: (x: T) => void) => (x: T) => { f(x); setSucio(true); setEstado(null); };

  const ingredientes = Object.entries(cat.ingredientes).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const subrecetas = Object.entries(cat.subrecetas).filter(([id]) => id !== p.recipeId).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const equipos = Object.entries(cat.equipos);
  const perfiles = Object.entries(cat.perfiles);
  const consumibles = Object.entries(cat.consumibles).filter(([, c]) => c.per);

  const datos: VersionEditable = {
    kind: kind, portions, yield_quantity: yieldQ, yield_unit: yieldU, labor_is_variable: laborVar, use_overheads: useOver,
    ingredientes: ings.map(sinClave), equipos: eqs.map(sinClave),
    personal: labs.map(sinClave), consumibles: cons.map(sinClave),
  };
  const tasa = p.impuestosVenta.find((x) => x.id === imp)?.rate ?? null;
  const calc = useMemo(
    () => calcularDesdeCatalogo(datos, cat, kind === "dish" && pvp.trim() ? { name: "Simulación", pvp, pvpIncludesTax: true, taxRate: tasa } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(datos), cat, pvp, tasa],
  );

  const alergenos = alergenosDe(datos, cat, extraAl);
  const alergenosBase = alergenosDe(datos, cat, []);
  const minutosPasos = pasos.reduce((a, x) => a + (Number(x.minutes.replace(",", ".")) || 0), 0);
  const totalMin = (Number(prep.replace(",", ".")) || 0) + (Number(cook.replace(",", ".")) || 0) + (Number(rest.replace(",", ".")) || 0);
  const horas = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60) ? `${Math.round(m % 60)} min` : ""}`.trim() : `${Math.round(m)} min`);

  const guardar = (yActivar = false) => start(async () => {
    const r = await guardarBorrador(p.rid, p.recipeId, v.id, versionActual, {
      ...datos, steps, notes, yield_unit: kind === "preparation" ? yieldU : "",
      prep_minutes: prep, cook_minutes: cook, rest_minutes: rest, shelf_life_hours: vida, storage, serving, portion_size: portionSize,
      extra_allergens: extraAl, pasos: pasos.filter((x) => x.description.trim()).map(sinClave),
    });
    if (!r.ok) { setEstado(r); return; }
    if (r.version) setVersionActual(r.version);
    setSucio(false);
    if (yActivar) {
      const a = await activarVersion(p.rid, p.recipeId, v.id);
      setEstado(a);
      if (a.ok) router.refresh();
    } else {
      setEstado(r);
      router.refresh();
    }
  });

  const unidadesIng = (id: string | null, sub: string | null): QuantityUnit => {
    if (sub) { const s = cat.subrecetas[sub]; return s?.baseUnit === "unit" ? "unit" : (s?.baseUnit ?? "g"); }
    const i = id ? cat.ingredientes[id] : undefined;
    return i?.baseUnit === "unit" ? "unit" : (i?.baseUnit ?? "g");
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        {libre && (
          <div className="rounded-[22px] bg-white p-5 ring-1 ring-linea">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_160px]">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-grafito">Nombre (para guardarlo como receta)</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Hamburguesa trufada" className={claseInput} />
              </label>
              <Sel label="Tipo" value={kind} onChange={(x) => setKind(x as "dish" | "preparation")}>
                <option value="dish">Plato de venta</option>
                <option value="preparation">Elaboración</option>
              </Sel>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-grafito">Categoría</span>
                <input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder={kind === "dish" ? "Principales" : "Salsas"} className={claseInput} />
              </label>
            </div>
            {p.puedeEditar ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-niebla">Calcula lo que quieras; no se guarda nada hasta que pulses el botón.</p>
                <button type="button" disabled={pendiente} onClick={() => start(async () => {
                  const r = await guardarComoReceta(p.rid, nombre, kind, categoria, {
                    ...datos, steps, notes, yield_unit: kind === "preparation" ? yieldU : "",
                    prep_minutes: prep, cook_minutes: cook, rest_minutes: rest, shelf_life_hours: vida, storage, serving, portion_size: portionSize,
                    extra_allergens: extraAl, pasos: pasos.filter((x) => x.description.trim()).map(sinClave),
                  });
                  setEstado(r);
                  if (r.ok && r.id) router.push(`/panel/${p.rid}/recetas/${r.id}`);
                })} className="h-10 rounded-full bg-tinta px-5 text-[14px] font-medium text-crema hover:bg-grafito disabled:opacity-60">
                  {pendiente ? "Guardando…" : "Guardar como receta"}
                </button>
              </div>
            ) : <p className="mt-3 text-[12px] text-niebla">Simulación: no tienes permiso para guardar recetas.</p>}
          </div>
        )}
        {libre && estado && <p aria-live="polite" className={`text-[13px] ${estado.ok ? "text-musgo" : "text-error"}`}>{estado.ok ? "✓ " : ""}{estado.mensaje}</p>}
        {!libre && (<>
        {/* --------------------------------------------------- barra de estado */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-white px-5 py-4 ring-1 ring-linea">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-semibold">Versión {v.number}</span>
            <Insignia tono={v.status === "active" ? "ok" : v.status === "draft" ? "estimado" : "neutro"}>
              {v.status === "active" ? "Activa" : v.status === "draft" ? "Borrador" : "Sustituida"}
            </Insignia>
            {sucio && <span className="text-[13px] text-ambar">Cambios sin guardar</span>}
          </div>
          {p.puedeEditar && (
            <div className="flex flex-wrap items-center gap-2">
              {v.status === "draft" ? (
                <>
                  {p.hayActiva && (
                    <button type="button" disabled={pendiente} onClick={() => start(async () => { const r = await descartarBorrador(p.rid, p.recipeId, v.id); setEstado(r); if (r.ok) router.refresh(); })}
                      className="h-9 rounded-full px-4 text-[13px] font-medium text-niebla hover:text-tinta">Descartar</button>
                  )}
                  <button type="button" disabled={pendiente} onClick={() => guardar(false)}
                    className="h-9 rounded-full bg-crema-2 px-4 text-[13px] font-medium hover:bg-linea disabled:opacity-60">{pendiente ? "Guardando…" : "Guardar borrador"}</button>
                  <button type="button" disabled={pendiente} onClick={() => guardar(true)}
                    className="h-9 rounded-full bg-tinta px-4 text-[13px] font-medium text-crema hover:bg-grafito disabled:opacity-60">Guardar y activar</button>
                </>
              ) : (
                <button type="button" disabled={pendiente} onClick={() => start(async () => { const r = await nuevaVersion(p.rid, p.recipeId); setEstado(r); if (r.ok) router.refresh(); })}
                  className="h-9 rounded-full bg-tinta px-4 text-[13px] font-medium text-crema hover:bg-grafito disabled:opacity-60">Crear nueva versión</button>
              )}
            </div>
          )}
        </div>
        {estado && <p aria-live="polite" className={`text-[13px] ${estado.ok ? "text-musgo" : "text-error"}`}>{estado.ok ? "✓ " : ""}{estado.mensaje}</p>}
        {!editable && v.status !== "draft" && p.puedeEditar && (
          <p className="text-[13px] text-niebla">Las versiones activas no se modifican. Crea una nueva versión para cambiar la receta; esta quedará en el histórico.</p>
        )}
        </>)}

        {!libre && <div className="flex flex-wrap gap-2" role="tablist" aria-label="Partes de la ficha">
          {([["composicion", "Composición y coste"], ["proceso", `Proceso${pasos.length ? ` · ${pasos.length} pasos` : ""}`], ["conservacion", "Conservación y alérgenos"]] as const).map(([id, t]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`h-9 rounded-full px-4 text-[13px] font-medium transition ${tab === id ? "bg-tinta text-crema" : "bg-white ring-1 ring-linea hover:bg-crema-2"}`}>
              {t}
            </button>
          ))}
        </div>}

        {(libre || tab === "composicion") && (<>
        <Bloque titulo="Producción">
          <div className="grid gap-4 sm:grid-cols-3">
            {kind === "dish" ? (
              <Num label="Raciones vendibles por tanda" value={portions} onChange={marcar(setPortions)} unidad="rac." disabled={!editable} />
            ) : (
              <>
                <Num label="Cantidad producida por tanda" value={yieldQ} onChange={marcar(setYieldQ)} disabled={!editable}
                  ayuda="Resultado final ya cocinado/reducido." />
                <Sel label="Unidad" value={yieldU} onChange={marcar((x: string) => setYieldU(x as "g" | "ml" | "unit"))} disabled={!editable}>
                  <option value="g">gramos</option><option value="ml">mililitros</option><option value="unit">unidades</option>
                </Sel>
              </>
            )}
          </div>
        </Bloque>

        <Bloque
          titulo="Ingredientes y elaboraciones"
          vacio={ingredientes.length === 0 && subrecetas.length === 0 ? "Crea materias primas para poder usarlas." : undefined}
          onAdd={editable ? () => marcar(setIngs)([...ings, {
            key: k(), ingredient_id: ingredientes[0]?.[0] ?? null, sub_recipe_id: ingredientes.length ? null : subrecetas[0]?.[0] ?? null,
            quantity: "", unit: ingredientes.length ? unidadesIng(ingredientes[0][0], null) : "g", quantity_type: "net",
          }]) : undefined}
        >
          {ings.map((f) => {
            const valor = f.sub_recipe_id ? `r:${f.sub_recipe_id}` : `i:${f.ingredient_id}`;
            return (
              <Fila key={f.key} cols="lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.5fr)]"
                onRemove={editable ? () => marcar(setIngs)(ings.filter((x) => x.key !== f.key)) : undefined}>
                <Sel label="Materia prima o elaboración" value={valor} className="sm:col-span-2 lg:col-span-1" disabled={!editable}
                  onChange={marcar((x: string) => setIngs(ings.map((y) => y.key !== f.key ? y : x.startsWith("r:")
                    ? { ...y, sub_recipe_id: x.slice(2), ingredient_id: null, unit: unidadesIng(null, x.slice(2)), quantity_type: "gross" }
                    : { ...y, ingredient_id: x.slice(2), sub_recipe_id: null, unit: unidadesIng(x.slice(2), null) })))}>
                  {ingredientes.length > 0 && (
                    <optgroup label="Materias primas">
                      {ingredientes.map(([id, i]) => <option key={id} value={`i:${id}`}>{i.name}{i.pricePerBaseUnit === null ? " · sin precio" : ""}</option>)}
                    </optgroup>
                  )}
                  {subrecetas.length > 0 && (
                    <optgroup label="Elaboraciones">
                      {subrecetas.map(([id, s]) => <option key={id} value={`r:${id}`}>{s.name}{s.costPerUnit === null ? " · sin coste" : ""}</option>)}
                    </optgroup>
                  )}
                </Sel>
                <Num label="Cantidad" value={f.quantity} disabled={!editable} onChange={marcar((x: string) => setIngs(ings.map((y) => y.key === f.key ? { ...y, quantity: x } : y)))} />
                <Sel label="Unidad" value={f.unit} disabled={!editable} onChange={marcar((x: string) => setIngs(ings.map((y) => y.key === f.key ? { ...y, unit: x as QuantityUnit } : y)))}>
                  <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="unit">ud</option>
                </Sel>
                {f.sub_recipe_id ? (
                  <p className="self-end pb-3 text-[12px] text-niebla">Cantidad ya elaborada: no se aplica merma.</p>
                ) : (
                  <Sel label="La cantidad es" value={f.quantity_type} disabled={!editable}
                    onChange={marcar((x: string) => setIngs(ings.map((y) => y.key === f.key ? { ...y, quantity_type: x as "net" | "gross" } : y)))}>
                    <option value="net">Neta (+ merma)</option>
                    <option value="gross">Bruta</option>
                  </Sel>
                )}
              </Fila>
            );
          })}
          {editable && p.puedeCrearMaterias && (
            <NuevaMateria rid={p.rid} onCreada={(m) => {
              setCat((c) => ({ ...c, ingredientes: { ...c.ingredientes, [m.id]: { id: m.id, name: m.name, baseUnit: m.baseUnit, yieldRatio: m.yieldRatio, pricePerBaseUnit: m.pricePerBaseUnit, priceQuality: "measured", allergens: m.allergens } } }));
              marcar(setIngs)([...ings, { key: k(), ingredient_id: m.id, sub_recipe_id: null, quantity: "", unit: m.baseUnit === "unit" ? "unit" : m.baseUnit, quantity_type: "net" }]);
            }} />
          )}
        </Bloque>

        <Bloque titulo="Equipos y energía" vacio={equipos.length === 0 ? "Crea equipos con potencia y tarifa." : undefined}
          onAdd={editable ? () => marcar(setEqs)([...eqs, { key: k(), equipment_id: equipos[0][0], minutes: "", usage_share: "1", preheat_share: "1", measured_consumption: null }]) : undefined}>
          {eqs.map((f) => {
            const e = cat.equipos[f.equipment_id];
            return (
              <Fila key={f.key} onRemove={editable ? () => marcar(setEqs)(eqs.filter((x) => x.key !== f.key)) : undefined}>
                <Sel label="Equipo" value={f.equipment_id} className="sm:col-span-2" disabled={!editable}
                  onChange={marcar((x: string) => setEqs(eqs.map((y) => y.key === f.key ? { ...y, equipment_id: x } : y)))}>
                  {equipos.map(([id, x]) => <option key={id} value={id}>{x.name}{x.tariffPricePerUnit === null ? " · sin tarifa" : ""}</option>)}
                </Sel>
                <Num label="Minutos de uso" value={f.minutes} unidad="min" disabled={!editable} onChange={marcar((x: string) => setEqs(eqs.map((y) => y.key === f.key ? { ...y, minutes: x } : y)))} />
                <Num label="Uso atribuido" value={pctTexto(f.usage_share)} unidad="%" disabled={!editable} onChange={marcar((x: string) => setEqs(eqs.map((y) => y.key === f.key ? { ...y, usage_share: pctValor(x) } : y)))} />
                {e && Number(e.preheatMinutes) > 0 && (
                  <Num label={`Precalentamiento (${numero(e.preheatMinutes)} min) atribuido`} value={pctTexto(f.preheat_share)} unidad="%" disabled={!editable}
                    onChange={marcar((x: string) => setEqs(eqs.map((y) => y.key === f.key ? { ...y, preheat_share: pctValor(x) } : y)))} />
                )}
                <Num label="Consumo medido (opcional)" value={f.measured_consumption ?? ""} unidad={e?.tariffUnit ?? "kWh"} disabled={!editable}
                  onChange={marcar((x: string) => setEqs(eqs.map((y) => y.key === f.key ? { ...y, measured_consumption: x || null } : y)))} />
              </Fila>
            );
          })}
        </Bloque>

        <Bloque titulo="Personal" vacio={perfiles.length === 0 ? "Crea perfiles de personal." : undefined}
          onAdd={editable ? () => marcar(setLabs)([...labs, { key: k(), labor_profile_id: perfiles[0][0], active_minutes: "" }]) : undefined}>
          {labs.map((f) => (
            <Fila key={f.key} onRemove={editable ? () => marcar(setLabs)(labs.filter((x) => x.key !== f.key)) : undefined}>
              <Sel label="Perfil" value={f.labor_profile_id} className="sm:col-span-2" disabled={!editable}
                onChange={marcar((x: string) => setLabs(labs.map((y) => y.key === f.key ? { ...y, labor_profile_id: x } : y)))}>
                {perfiles.map(([id, x]) => <option key={id} value={id}>{x.name} · {euro(x.costPerHour)}/h</option>)}
              </Sel>
              <Num label="Minutos activos" value={f.active_minutes} unidad="min" disabled={!editable}
                onChange={marcar((x: string) => setLabs(labs.map((y) => y.key === f.key ? { ...y, active_minutes: x } : y)))} />
            </Fila>
          ))}
          {labs.length > 0 && (
            <label className="mt-2 flex items-center gap-2 text-[13px] text-grafito">
              <input type="checkbox" checked={laborVar} disabled={!editable} onChange={(e) => marcar(setLaborVar)(e.target.checked)} className="h-4 w-4 accent-musgo" />
              Tratar el personal como coste variable (resta en el margen de contribución)
            </label>
          )}
        </Bloque>

        <Bloque titulo="Envases y consumibles" vacio={consumibles.length === 0 ? "Crea consumibles por ración o por tanda en Equipos." : undefined}
          onAdd={editable ? () => marcar(setCons)([...cons, { key: k(), consumable_id: consumibles[0][0] }]) : undefined}>
          {cons.map((f) => (
            <Fila key={f.key} onRemove={editable ? () => marcar(setCons)(cons.filter((x) => x.key !== f.key)) : undefined}>
              <Sel label="Concepto" value={f.consumable_id} className="sm:col-span-2" disabled={!editable}
                onChange={marcar((x: string) => setCons(cons.map((y) => y.key === f.key ? { ...y, consumable_id: x } : y)))}>
                {consumibles.map(([id, c]) => <option key={id} value={id}>{c.name} · {euro(c.amount, 4)} {c.per === "portion" ? "por ración" : "por tanda"}</option>)}
              </Sel>
            </Fila>
          ))}
        </Bloque>

        {kind === "dish" && (
          <Bloque titulo="Gastos generales y precio">
            <label className="flex items-center gap-2 text-[13px] text-grafito">
              <input type="checkbox" checked={useOver} disabled={!editable} onChange={(e) => marcar(setUseOver)(e.target.checked)} className="h-4 w-4 accent-musgo" />
              Sumar gastos generales por ración {cat.overheads ? `(${euro(cat.overheads.value, 3)})` : "(sin base configurada)"}
            </label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Num label="Simular PVP (no se guarda)" value={pvp} onChange={setPvp} unidad="€" ayuda="Los precios reales por canal se fijan en Carta." />
              <Sel label="Impuesto incluido" value={imp} onChange={setImp}>
                <option value="">Sin configurar</option>
                {p.impuestosVenta.map((x) => <option key={x.id} value={x.id}>{x.name} · {numero(Number(x.rate) * 100)} %</option>)}
              </Sel>
            </div>
          </Bloque>
        )}

        </>)}

        {(libre || tab === "proceso") && (<>
          <Bloque titulo="Tiempos">
            <div className="grid gap-4 sm:grid-cols-4">
              <Num label="Preparación" value={prep} onChange={marcar(setPrep)} unidad="min" disabled={!editable} />
              <Num label="Cocción" value={cook} onChange={marcar(setCook)} unidad="min" disabled={!editable} />
              <Num label="Reposo / enfriado" value={rest} onChange={marcar(setRest)} unidad="min" disabled={!editable} />
              <div className="rounded-xl bg-crema-2 px-4 py-2.5">
                <p className="text-[12px] font-medium text-grafito">Tiempo total</p>
                <p className="text-[20px] font-semibold tabular-nums">{totalMin ? horas(totalMin) : "—"}</p>
              </div>
            </div>
            {minutosPasos > 0 && <p className="mt-2 text-[12px] text-niebla">Los pasos suman {horas(minutosPasos)}.</p>}
          </Bloque>

          <Bloque titulo="Proceso de elaboración" onAdd={editable ? () => marcar(setPasos)([...pasos, { key: k(), title: "", description: "", minutes: "", temperature_c: "", equipment_id: null, is_critical: false }]) : undefined}>
            {pasos.length === 0 && <p className="text-[13px] text-niebla">Añade los pasos en orden: qué se hace, cuánto tarda, a qué temperatura y con qué equipo.</p>}
            <ol className="space-y-3">
              {pasos.map((x, i) => (
                <li key={x.key} className="relative rounded-2xl bg-crema/70 p-4 pr-12">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-tinta text-[13px] font-semibold text-crema">{i + 1}</span>
                    <input value={x.title} disabled={!editable} placeholder="Título del paso (opcional)"
                      onChange={(e) => marcar(setPasos)(pasos.map((y) => y.key === x.key ? { ...y, title: e.target.value } : y))}
                      className="flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-niebla/60" />
                    {editable && (
                      <span className="flex gap-1">
                        <button type="button" disabled={i === 0} aria-label="Subir" onClick={() => marcar(setPasos)(pasos.map((_, j) => pasos[j === i - 1 ? i : j === i ? i - 1 : j]))} className="h-7 w-7 rounded-full text-niebla hover:bg-white disabled:opacity-30">↑</button>
                        <button type="button" disabled={i === pasos.length - 1} aria-label="Bajar" onClick={() => marcar(setPasos)(pasos.map((_, j) => pasos[j === i + 1 ? i : j === i ? i + 1 : j]))} className="h-7 w-7 rounded-full text-niebla hover:bg-white disabled:opacity-30">↓</button>
                      </span>
                    )}
                  </div>
                  <textarea value={x.description} disabled={!editable} rows={2} placeholder="Qué se hace en este paso"
                    onChange={(e) => marcar(setPasos)(pasos.map((y) => y.key === x.key ? { ...y, description: e.target.value } : y))}
                    className={`${claseInput} h-auto py-2.5`} />
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <Num label="Tiempo" value={x.minutes} unidad="min" disabled={!editable} onChange={marcar((val: string) => setPasos(pasos.map((y) => y.key === x.key ? { ...y, minutes: val } : y)))} />
                    <Num label="Temperatura" value={x.temperature_c} unidad="°C" disabled={!editable} onChange={marcar((val: string) => setPasos(pasos.map((y) => y.key === x.key ? { ...y, temperature_c: val } : y)))} />
                    <Sel label="Equipo" value={x.equipment_id ?? ""} disabled={!editable} onChange={marcar((val: string) => setPasos(pasos.map((y) => y.key === x.key ? { ...y, equipment_id: val || null } : y)))}>
                      <option value="">—</option>
                      {equipos.map(([id, e]) => <option key={id} value={id}>{e.name}</option>)}
                    </Sel>
                    <label className="flex items-center gap-2 self-end pb-3 text-[13px] text-grafito">
                      <input type="checkbox" checked={x.is_critical} disabled={!editable} onChange={(e) => marcar(setPasos)(pasos.map((y) => y.key === x.key ? { ...y, is_critical: e.target.checked } : y))} className="h-4 w-4 accent-terracota" />
                      Punto crítico
                    </label>
                  </div>
                  {editable && (
                    <button type="button" aria-label="Quitar paso" onClick={() => marcar(setPasos)(pasos.filter((y) => y.key !== x.key))}
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-niebla hover:bg-white hover:text-tinta">×</button>
                  )}
                </li>
              ))}
            </ol>
          </Bloque>

          <Bloque titulo="Notas de cocina">
            <textarea value={steps} disabled={!editable} onChange={(e) => marcar(setSteps)(e.target.value)} rows={3} placeholder="Trucos, variaciones, observaciones…" className={`${claseInput} h-auto py-3`} />
          </Bloque>
        </>)}

        {(libre || tab === "conservacion") && (<>
          <Bloque titulo="Conservación">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-grafito">Cómo se conserva</span>
                <input value={storage} disabled={!editable} onChange={(e) => marcar(setStorage)(e.target.value)} placeholder="Cámara 0–4 °C, envasado al vacío…" className={claseInput} />
              </label>
              <Num label="Vida útil" value={vida} onChange={marcar(setVida)} unidad="h" disabled={!editable} ayuda={vida ? `≈ ${(Number(vida.replace(",", ".")) / 24).toFixed(1).replace(".", ",")} días` : "Desde que se elabora."} />
            </div>
          </Bloque>
          {kind === "dish" && (
            <Bloque titulo="Presentación">
              <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-grafito">Tamaño de ración</span>
                  <input value={portionSize} disabled={!editable} onChange={(e) => marcar(setPortionSize)(e.target.value)} placeholder="250 g" className={claseInput} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-grafito">Emplatado y servicio</span>
                  <textarea value={serving} disabled={!editable} onChange={(e) => marcar(setServing)(e.target.value)} rows={3} placeholder="Plato hondo, aceite en hilo, cebollino picado…" className={`${claseInput} h-auto py-3`} />
                </label>
              </div>
            </Bloque>
          )}
          <Bloque titulo="Alérgenos">
            <p className="text-[13px] text-niebla">Se calculan solos a partir de las materias primas y elaboraciones. Marca además los que aporte el proceso o las trazas.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ALERGENOS.map((a) => {
                const heredado = alergenosBase.includes(a);
                const marcado = heredado || extraAl.includes(a);
                return (
                  <button key={a} type="button" disabled={!editable || heredado}
                    onClick={() => marcar(setExtraAl)(extraAl.includes(a) ? extraAl.filter((x) => x !== a) : [...extraAl, a])}
                    className={`h-8 rounded-full px-3.5 text-[13px] font-medium capitalize transition ${marcado ? "bg-terracota text-white" : "bg-crema-2 text-grafito hover:bg-linea"} ${heredado ? "cursor-default" : ""}`}
                    title={heredado ? "Viene de los ingredientes" : undefined}>
                    {a}{heredado ? " ·" : ""}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] text-niebla">«·» = viene de los ingredientes. Revisa siempre las fichas de tus proveedores.</p>
          </Bloque>
          <Bloque titulo="Notas">
            <textarea value={notes} disabled={!editable} onChange={(e) => marcar(setNotes)(e.target.value)} rows={2} className={`${claseInput} h-auto py-3`} />
          </Bloque>
        </>)}
      </div>

      <div className="space-y-4 lg:sticky lg:top-8">
        {kind === "preparation" && (
          <div className="rounded-[22px] bg-tinta p-6 text-crema">
            <p className="text-[13px] text-crema/60">Coste de la elaboración</p>
            <p className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
              {calc.result.costs.direct_per_portion === null ? "—" : euro(Number(calc.result.costs.direct_per_portion) * (yieldU === "unit" ? 1 : 1000), p.decimales)}
            </p>
            <p className="mt-1 text-[13px] text-crema/60">por {yieldU === "g" ? "kg" : yieldU === "ml" ? "litro" : "unidad"} · tanda {calc.result.batch.direct ? euro(calc.result.batch.direct, 2) : "pendiente"}</p>
          </div>
        )}
        <div className="rounded-[22px] bg-white p-5 ring-1 ring-linea">
          <p className="text-[13px] font-medium text-niebla">Ficha</p>
          <dl className="mt-3 space-y-2 text-[14px]">
            <div className="flex justify-between gap-3"><dt className="text-grafito">Tiempo total</dt><dd className="font-medium">{totalMin ? horas(totalMin) : "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-grafito">Pasos</dt><dd className="font-medium">{pasos.length || "—"}{pasos.some((x) => x.is_critical) ? " · con punto crítico" : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-grafito">Vida útil</dt><dd className="font-medium">{vida ? `${vida} h` : "—"}</dd></div>
          </dl>
          <p className="mt-3 text-[12px] font-medium text-grafito">Alérgenos</p>
          <p className="mt-1 text-[13px] capitalize text-terracota">{alergenos.length ? alergenos.join(" · ") : <span className="normal-case text-niebla">Sin alérgenos declarados</span>}</p>
        </div>
        {calc.avisos.length > 0 && (
          <ul className="space-y-1 rounded-[22px] bg-ambar-claro px-5 py-4 text-[13px] text-ambar">
            {calc.avisos.map((a) => <li key={a}>▲ {a}</li>)}
          </ul>
        )}
        <Resultado res={calc.result} decimales={p.decimales} />
      </div>
    </div>
  );
}

/** Alta rápida de materia prima con precio, sin salir del escandallo. */
function NuevaMateria({ rid, onCreada }: { rid: string; onCreada: (m: { id: string; name: string; baseUnit: "g" | "ml" | "unit"; yieldRatio: string; pricePerBaseUnit: string | null; allergens: string[] }) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState<"g" | "ml" | "unit">("g");
  const [precio, setPrecio] = useState("");
  const [rend, setRend] = useState("100");
  const [al, setAl] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pend, start] = useTransition();
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="mt-1 text-[13px] font-medium text-musgo hover:underline">
        + ¿No está en la lista? Crear materia prima con su precio
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-2xl border border-dashed border-linea p-4">
      <p className="mb-3 text-[14px] font-semibold">Nueva materia prima</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[12px] font-medium text-grafito">Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={claseInput} />
        </label>
        <Sel label="Se mide en" value={unidad} onChange={(x) => setUnidad(x as "g" | "ml" | "unit")}>
          <option value="g">kg / g</option><option value="ml">litros / ml</option><option value="unit">unidades</option>
        </Sel>
        <Num label={`Precio por ${unidad === "g" ? "kg" : unidad === "ml" ? "litro" : "unidad"} (sin IVA)`} value={precio} onChange={setPrecio} unidad="€" />
        <Num label="Rendimiento aprovechable" value={rend} onChange={setRend} unidad="%" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ALERGENOS.map((a) => (
          <button key={a} type="button" onClick={() => setAl(al.includes(a) ? al.filter((x) => x !== a) : [...al, a])}
            className={`h-7 rounded-full px-3 text-[12px] capitalize ${al.includes(a) ? "bg-terracota text-white" : "bg-crema-2 text-grafito"}`}>{a}</button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" disabled={pend} onClick={() => start(async () => {
          const r = await crearMateriaRapida(rid, { name: nombre, base_unit: unidad, yield_pct: rend, price: precio, allergens: al });
          setMsg(r);
          if (r.ok && r.ingrediente) {
            onCreada(r.ingrediente);
            setNombre(""); setPrecio(""); setRend("100"); setAl([]); setAbierto(false);
          }
        })} className="h-9 rounded-full bg-tinta px-4 text-[13px] font-medium text-crema disabled:opacity-60">{pend ? "Creando…" : "Crear y añadir"}</button>
        <button type="button" onClick={() => setAbierto(false)} className="text-[13px] text-niebla">Cancelar</button>
        {msg && !msg.ok && <span className="text-[13px] text-error">{msg.mensaje}</span>}
      </div>
    </div>
  );
}
