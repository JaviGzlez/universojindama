"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Insignia, claseInput, euro, numero } from "@/components/ui";
import type { QuantityUnit } from "@/lib/engine";
import { calcularDesdeCatalogo, type CatalogoPlano, type VersionEditable } from "@/lib/recetas-entrada";
import { Bloque, Fila, Num, Resultado, Sel } from "../../escandallo/calculadora";
import { activarVersion, descartarBorrador, guardarBorrador, nuevaVersion } from "../actions";

type LineaIng = VersionEditable["ingredientes"][number] & { key: number };
type LineaEq = VersionEditable["equipos"][number] & { key: number };
type LineaLab = VersionEditable["personal"][number] & { key: number };
type LineaCon = VersionEditable["consumibles"][number] & { key: number };

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
  };
  hayActiva: boolean;
  puedeEditar: boolean;
  catalogo: CatalogoPlano;
  impuestosVenta: { id: string; name: string; rate: string }[];
  decimales: number;
}

export function EditorReceta(p: PropsEditor) {
  const router = useRouter();
  const v = p.version;
  const editable = p.puedeEditar && v.status === "draft";
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
  const [pvp, setPvp] = useState("");
  const [imp, setImp] = useState(p.impuestosVenta[0]?.id ?? "");
  const [sucio, setSucio] = useState(false);
  const [estado, setEstado] = useState<{ ok: boolean; mensaje: string } | null>(null);
  const [pendiente, start] = useTransition();
  const [versionActual, setVersionActual] = useState(v.version);
  const marcar = <T,>(f: (x: T) => void) => (x: T) => { f(x); setSucio(true); setEstado(null); };

  const ingredientes = Object.entries(p.catalogo.ingredientes).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const subrecetas = Object.entries(p.catalogo.subrecetas).filter(([id]) => id !== p.recipeId).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const equipos = Object.entries(p.catalogo.equipos);
  const perfiles = Object.entries(p.catalogo.perfiles);
  const consumibles = Object.entries(p.catalogo.consumibles).filter(([, c]) => c.per);

  const datos: VersionEditable = {
    kind: p.kind, portions, yield_quantity: yieldQ, yield_unit: yieldU, labor_is_variable: laborVar, use_overheads: useOver,
    ingredientes: ings.map(sinClave), equipos: eqs.map(sinClave),
    personal: labs.map(sinClave), consumibles: cons.map(sinClave),
  };
  const tasa = p.impuestosVenta.find((x) => x.id === imp)?.rate ?? null;
  const calc = useMemo(
    () => calcularDesdeCatalogo(datos, p.catalogo, p.kind === "dish" && pvp.trim() ? { name: "Simulación", pvp, pvpIncludesTax: true, taxRate: tasa } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(datos), p.catalogo, pvp, tasa],
  );

  const guardar = (yActivar = false) => start(async () => {
    const r = await guardarBorrador(p.rid, p.recipeId, v.id, versionActual, { ...datos, steps, notes, yield_unit: p.kind === "preparation" ? yieldU : "" });
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
    if (sub) { const s = p.catalogo.subrecetas[sub]; return s?.baseUnit === "unit" ? "unit" : (s?.baseUnit ?? "g"); }
    const i = id ? p.catalogo.ingredientes[id] : undefined;
    return i?.baseUnit === "unit" ? "unit" : (i?.baseUnit ?? "g");
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
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

        <Bloque titulo="Producción">
          <div className="grid gap-4 sm:grid-cols-3">
            {p.kind === "dish" ? (
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
        </Bloque>

        <Bloque titulo="Equipos y energía" vacio={equipos.length === 0 ? "Crea equipos con potencia y tarifa." : undefined}
          onAdd={editable ? () => marcar(setEqs)([...eqs, { key: k(), equipment_id: equipos[0][0], minutes: "", usage_share: "1", preheat_share: "1", measured_consumption: null }]) : undefined}>
          {eqs.map((f) => {
            const e = p.catalogo.equipos[f.equipment_id];
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

        {p.kind === "dish" && (
          <Bloque titulo="Gastos generales y precio">
            <label className="flex items-center gap-2 text-[13px] text-grafito">
              <input type="checkbox" checked={useOver} disabled={!editable} onChange={(e) => marcar(setUseOver)(e.target.checked)} className="h-4 w-4 accent-musgo" />
              Sumar gastos generales por ración {p.catalogo.overheads ? `(${euro(p.catalogo.overheads.value, 3)})` : "(sin base configurada)"}
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

        <Bloque titulo="Elaboración y notas">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-grafito">Pasos</span>
            <textarea value={steps} disabled={!editable} onChange={(e) => marcar(setSteps)(e.target.value)} rows={6} className={`${claseInput} h-auto py-3`} />
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-[12px] font-medium text-grafito">Notas</span>
            <textarea value={notes} disabled={!editable} onChange={(e) => marcar(setNotes)(e.target.value)} rows={2} className={`${claseInput} h-auto py-3`} />
          </label>
        </Bloque>
      </div>

      <div className="space-y-4 lg:sticky lg:top-8">
        {p.kind === "preparation" && (
          <div className="rounded-[22px] bg-tinta p-6 text-crema">
            <p className="text-[13px] text-crema/60">Coste de la elaboración</p>
            <p className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
              {calc.result.costs.direct_per_portion === null ? "—" : euro(Number(calc.result.costs.direct_per_portion) * (yieldU === "unit" ? 1 : 1000), p.decimales)}
            </p>
            <p className="mt-1 text-[13px] text-crema/60">por {yieldU === "g" ? "kg" : yieldU === "ml" ? "litro" : "unidad"} · tanda {calc.result.batch.direct ? euro(calc.result.batch.direct, 2) : "pendiente"}</p>
          </div>
        )}
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
