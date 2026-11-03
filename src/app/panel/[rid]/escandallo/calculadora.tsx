"use client";

import { useMemo, useState } from "react";
import { calculate, type CalculationInput, type CalculationResult, type DataQuality, type EnergySource, type IngredientRef, type QuantityUnit } from "@/lib/engine";
import { Insignia, claseInput, euro, numero } from "@/components/ui";

export interface DatosCalculadora {
  moneda: string;
  decimales: number;
  ingredientes: IngredientRef[];
  equipos: {
    id: string; name: string; source: EnergySource; nominalPowerW: string | null; powerQuality: DataQuality;
    dutyFactor: string; dutyFactorQuality: DataQuality; preheatMinutes: string;
    tariffPricePerUnit: string | null; tariffUnit: string; tariffName: string | null;
  }[];
  perfiles: { id: string; name: string; costPerHour: string }[];
  consumibles: { id: string; name: string; amount: string; per: "portion" | "batch" }[];
  impuestosVenta: { id: string; name: string; rate: string }[];
}

interface FilaIng { key: number; id: string; cantidad: string; unidad: QuantityUnit; tipo: "net" | "gross" }
interface FilaEq { key: number; id: string; minutos: string; medido: string; precalentamiento: string; uso: string }
interface FilaLab { key: number; id: string; minutos: string }
interface FilaCons { key: number; id: string }

let contador = 0;
const k = () => ++contador;
const pct = (v: string) => (v.trim() === "" ? undefined : String(Number(v.replace(",", ".")) / 100));

export function Calculadora({ datos }: { datos: DatosCalculadora }) {
  const [raciones, setRaciones] = useState("4");
  const [ings, setIngs] = useState<FilaIng[]>([]);
  const [eqs, setEqs] = useState<FilaEq[]>([]);
  const [labs, setLabs] = useState<FilaLab[]>([]);
  const [cons, setCons] = useState<FilaCons[]>([]);
  const [indirectos, setIndirectos] = useState("");
  const [canal, setCanal] = useState({
    activo: true, nombre: "Sala", pvp: "", incluye: true, impuesto: datos.impuestosVenta[0]?.id ?? "",
    comision: "", base: "net" as "net" | "gross", fija: "", porPedido: "", envase: "",
  });

  const input: CalculationInput = useMemo(() => {
    const ingMap = new Map(datos.ingredientes.map((i) => [i.id, i]));
    const eqMap = new Map(datos.equipos.map((e) => [e.id, e]));
    const labMap = new Map(datos.perfiles.map((p) => [p.id, p]));
    const consMap = new Map(datos.consumibles.map((c) => [c.id, c]));
    const tax = datos.impuestosVenta.find((t) => t.id === canal.impuesto);
    return {
      currency: datos.moneda,
      valuationDate: new Date().toISOString().slice(0, 10),
      portions: raciones,
      ingredients: ings.filter((f) => ingMap.has(f.id)).map((f) => ({
        ingredient: ingMap.get(f.id)!, quantity: f.cantidad, unit: f.unidad, quantityType: f.tipo,
      })),
      equipment: eqs.filter((f) => eqMap.has(f.id)).map((f) => {
        const e = eqMap.get(f.id)!;
        return {
          id: e.id, name: e.name, source: e.source, minutes: f.minutos,
          nominalPowerW: e.nominalPowerW, powerQuality: e.powerQuality, dutyFactor: e.dutyFactor, dutyFactorQuality: e.dutyFactorQuality,
          measuredConsumption: f.medido.trim() === "" ? null : f.medido,
          preheatMinutes: e.preheatMinutes, preheatShare: pct(f.precalentamiento), usageShare: pct(f.uso),
          tariffPricePerUnit: e.tariffPricePerUnit, tariffUnit: e.tariffUnit,
        };
      }),
      labor: labs.filter((f) => labMap.has(f.id)).map((f) => {
        const p = labMap.get(f.id)!;
        return { id: p.id, name: p.name, activeMinutes: f.minutos, costPerHour: p.costPerHour };
      }),
      consumables: cons.filter((f) => consMap.has(f.id)).map((f) => {
        const c = consMap.get(f.id)!;
        return { id: c.id, name: c.name, amount: c.amount, per: c.per };
      }),
      overheadsPerPortion: indirectos.trim() === "" ? null : indirectos,
      channel: canal.activo
        ? {
            name: canal.nombre || "Canal", pvp: canal.pvp.trim() === "" ? null : canal.pvp, pvpIncludesTax: canal.incluye,
            taxRate: tax?.rate ?? null, commissionPct: pct(canal.comision), commissionBase: canal.base,
            fixedFeePerOrder: canal.fija || undefined, portionsPerOrder: canal.porPedido || undefined, packagingPerPortion: canal.envase || undefined,
          }
        : undefined,
    };
  }, [datos, raciones, ings, eqs, labs, cons, indirectos, canal]);

  const res = useMemo(() => calculate(input), [input]);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ------------------------------------------------------------ entradas */}
      <div className="space-y-5">
        <Bloque titulo="Producción">
          <div className="grid gap-4 sm:grid-cols-2">
            <Num label="Raciones vendibles por tanda" value={raciones} onChange={setRaciones} unidad="rac." />
          </div>
        </Bloque>

        <Bloque
          titulo="Materia prima" vacio={datos.ingredientes.length === 0 ? "Crea materias primas con precio para usarlas aquí." : undefined}
          onAdd={() => setIngs([...ings, { key: k(), id: datos.ingredientes[0].id, cantidad: "", unidad: defaultUnit(datos.ingredientes[0]), tipo: "net" }])}
        >
          {ings.map((f) => (
            <Fila key={f.key} cols="lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]" onRemove={() => setIngs(ings.filter((x) => x.key !== f.key))}>
              <Sel label="Ingrediente" value={f.id} className="sm:col-span-2 lg:col-span-1"
                onChange={(v) => setIngs(ings.map((x) => x.key === f.key ? { ...x, id: v, unidad: defaultUnit(datos.ingredientes.find((i) => i.id === v)!) } : x))}>
                {datos.ingredientes.map((i) => <option key={i.id} value={i.id}>{i.name}{i.pricePerBaseUnit === null ? " · sin precio" : ""}</option>)}
              </Sel>
              <Num label="Cantidad" value={f.cantidad} onChange={(v) => setIngs(ings.map((x) => x.key === f.key ? { ...x, cantidad: v } : x))} />
              <Sel label="Unidad" value={f.unidad} onChange={(v) => setIngs(ings.map((x) => x.key === f.key ? { ...x, unidad: v as QuantityUnit } : x))}>
                <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="unit">ud</option>
              </Sel>
              <Sel label="La cantidad es" value={f.tipo} onChange={(v) => setIngs(ings.map((x) => x.key === f.key ? { ...x, tipo: v as "net" | "gross" } : x))}>
                <option value="net">Neta (aplica merma)</option>
                <option value="gross">Bruta (sin merma)</option>
              </Sel>
            </Fila>
          ))}
        </Bloque>

        <Bloque
          titulo="Equipos y energía" vacio={datos.equipos.length === 0 ? "Crea equipos con potencia y tarifa para estimar la energía." : undefined}
          onAdd={() => setEqs([...eqs, { key: k(), id: datos.equipos[0].id, minutos: "", medido: "", precalentamiento: "100", uso: "100" }])}
        >
          {eqs.map((f) => {
            const e = datos.equipos.find((x) => x.id === f.id);
            return (
              <Fila key={f.key} onRemove={() => setEqs(eqs.filter((x) => x.key !== f.key))}>
                <Sel label="Equipo" value={f.id} className="sm:col-span-2" onChange={(v) => setEqs(eqs.map((x) => x.key === f.key ? { ...x, id: v } : x))}>
                  {datos.equipos.map((x) => <option key={x.id} value={x.id}>{x.name}{x.tariffPricePerUnit === null ? " · sin tarifa" : ""}</option>)}
                </Sel>
                <Num label="Minutos de uso" value={f.minutos} unidad="min" onChange={(v) => setEqs(eqs.map((x) => x.key === f.key ? { ...x, minutos: v } : x))} />
                <Num label="Uso atribuido a la tanda" value={f.uso} unidad="%" onChange={(v) => setEqs(eqs.map((x) => x.key === f.key ? { ...x, uso: v } : x))}
                  ayuda="Menos de 100 % si cocina otras cosas a la vez." />
                {e && Number(e.preheatMinutes) > 0 && (
                  <Num label={`Precalentamiento (${numero(e.preheatMinutes)} min) atribuido`} value={f.precalentamiento} unidad="%"
                    onChange={(v) => setEqs(eqs.map((x) => x.key === f.key ? { ...x, precalentamiento: v } : x))}
                    ayuda="Se imputa una vez por servicio; reparte entre las tandas." />
                )}
                <Num label="Consumo medido (opcional)" value={f.medido} unidad={e?.tariffUnit ?? "kWh"}
                  onChange={(v) => setEqs(eqs.map((x) => x.key === f.key ? { ...x, medido: v } : x))}
                  ayuda={e?.source === "electricity" ? "Sustituye a la estimación por potencia." : "Obligatorio en gas y agua."} />
              </Fila>
            );
          })}
        </Bloque>

        <Bloque
          titulo="Personal" vacio={datos.perfiles.length === 0 ? "Crea perfiles de personal con su coste por hora." : undefined}
          onAdd={() => setLabs([...labs, { key: k(), id: datos.perfiles[0].id, minutos: "" }])}
        >
          {labs.map((f) => (
            <Fila key={f.key} onRemove={() => setLabs(labs.filter((x) => x.key !== f.key))}>
              <Sel label="Perfil" value={f.id} className="sm:col-span-2" onChange={(v) => setLabs(labs.map((x) => x.key === f.key ? { ...x, id: v } : x))}>
                {datos.perfiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {euro(p.costPerHour)}/h</option>)}
              </Sel>
              <Num label="Minutos activos en la tanda" value={f.minutos} unidad="min" onChange={(v) => setLabs(labs.map((x) => x.key === f.key ? { ...x, minutos: v } : x))}
                ayuda="Dedicación real, no tiempo de cocción." />
            </Fila>
          ))}
        </Bloque>

        <Bloque
          titulo="Envases y consumibles" vacio={datos.consumibles.length === 0 ? "Crea consumibles por ración o por tanda en Equipos." : undefined}
          onAdd={() => setCons([...cons, { key: k(), id: datos.consumibles[0].id }])}
        >
          {cons.map((f) => (
            <Fila key={f.key} onRemove={() => setCons(cons.filter((x) => x.key !== f.key))}>
              <Sel label="Concepto" value={f.id} className="sm:col-span-2" onChange={(v) => setCons(cons.map((x) => x.key === f.key ? { ...x, id: v } : x))}>
                {datos.consumibles.map((c) => <option key={c.id} value={c.id}>{c.name} · {euro(c.amount, 4)} {c.per === "portion" ? "por ración" : "por tanda"}</option>)}
              </Sel>
            </Fila>
          ))}
        </Bloque>

        <Bloque titulo="Gastos generales">
          <div className="grid gap-4 sm:grid-cols-2">
            <Num label="Gastos indirectos asignados por ración" value={indirectos} onChange={setIndirectos} unidad="€"
              ayuda="Opcional. Según tu regla de reparto; se trata como estimación." />
          </div>
        </Bloque>

        <Bloque titulo="Precio y canal">
          <label className="mb-4 flex items-center gap-2 text-[14px] text-grafito">
            <input type="checkbox" checked={canal.activo} onChange={(e) => setCanal({ ...canal, activo: e.target.checked })} className="h-4 w-4 accent-musgo" />
            Calcular rentabilidad
          </label>
          {canal.activo && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Txt label="Canal" value={canal.nombre} onChange={(v) => setCanal({ ...canal, nombre: v })} />
              <Num label="PVP" value={canal.pvp} unidad="€" onChange={(v) => setCanal({ ...canal, pvp: v })} />
              <Sel label="El PVP" value={canal.incluye ? "si" : "no"} onChange={(v) => setCanal({ ...canal, incluye: v === "si" })}>
                <option value="si">Incluye impuesto</option><option value="no">No incluye impuesto</option>
              </Sel>
              <Sel label="Impuesto de venta" value={canal.impuesto} onChange={(v) => setCanal({ ...canal, impuesto: v })}>
                <option value="">Sin configurar</option>
                {datos.impuestosVenta.map((t) => <option key={t.id} value={t.id}>{t.name} · {numero(Number(t.rate) * 100)} %</option>)}
              </Sel>
              <Num label="Comisión" value={canal.comision} unidad="%" onChange={(v) => setCanal({ ...canal, comision: v })} />
              <Sel label="Base de la comisión" value={canal.base} onChange={(v) => setCanal({ ...canal, base: v as "net" | "gross" })}>
                <option value="net">Importe neto</option><option value="gross">Importe con impuestos</option>
              </Sel>
              <Num label="Comisión fija por pedido" value={canal.fija} unidad="€" onChange={(v) => setCanal({ ...canal, fija: v })} />
              <Num label="Raciones por pedido" value={canal.porPedido} onChange={(v) => setCanal({ ...canal, porPedido: v })} />
              <Num label="Envase del canal por ración" value={canal.envase} unidad="€" onChange={(v) => setCanal({ ...canal, envase: v })} />
            </div>
          )}
        </Bloque>
      </div>

      {/* ----------------------------------------------------------- resultado */}
      <Resultado res={res} decimales={datos.decimales} />
    </div>
  );
}

function defaultUnit(i: IngredientRef): QuantityUnit {
  return i.baseUnit === "unit" ? "unit" : i.baseUnit;
}

// ------------------------------------------------------------------ resultado
const ESTADO = {
  complete: { t: "Completo", tono: "ok" },
  estimated: { t: "Estimado", tono: "estimado" },
  incomplete: { t: "Incompleto", tono: "pendiente" },
} as const;
const CALIDAD = { measured: "real", manufacturer: "fabricante", estimated: "estimado" } as const;
const GRUPO = { ingredients: "Materia prima", energy: "Energía", labor: "Personal", consumables: "Consumibles", overheads: "Gastos generales", channel: "Canal" } as const;

function Resultado({ res, decimales }: { res: CalculationResult; decimales: number }) {
  const e = ESTADO[res.status];
  const total = res.costs.total_per_portion ?? res.costs.direct_per_portion;
  const p = res.profitability;
  return (
    <aside className="space-y-4 lg:sticky lg:top-8" aria-live="polite" aria-label="Resultado del cálculo">
      <div className="rounded-[22px] bg-white p-6 ring-1 ring-linea">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-niebla">{res.costs.total_per_portion ? "Coste completo por ración" : "Coste directo por ración"}</p>
          <Insignia tono={e.tono}>{e.t}</Insignia>
        </div>
        <p className="mt-2 text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
          {total === null ? <span className="text-niebla">—</span> : euro(total, decimales)}
        </p>
        <dl className="mt-6 space-y-2.5 text-[14px]">
          <Linea k="Materia prima" v={res.costs.ingredients} d={decimales} />
          <Linea k="Energía" v={res.costs.energy} d={decimales} />
          <Linea k="Personal" v={res.costs.labor} d={decimales} />
          <Linea k="Consumibles" v={res.costs.consumables} d={decimales} />
          <div className="border-t border-linea pt-2.5"><Linea k="Coste directo" v={res.costs.direct_per_portion} d={decimales} fuerte /></div>
          <Linea k="Gastos generales" v={res.costs.allocated_overheads} d={decimales} />
          <Linea k="Coste completo estimado" v={res.costs.total_per_portion} d={decimales} fuerte />
        </dl>
        {res.batch.direct && (
          <p className="mt-4 text-[12px] text-niebla">Tanda de {numero(res.portions)} raciones: {euro(res.batch.direct, decimales)} de coste directo.</p>
        )}
      </div>

      {res.coverage.profitability !== "not_requested" && (
        <div className="rounded-[22px] bg-white p-6 ring-1 ring-linea">
          <p className="text-[13px] font-medium text-niebla">Rentabilidad por ración</p>
          <dl className="mt-4 space-y-2.5 text-[14px]">
            <Linea k="Venta neta de impuesto" v={p.net_sale_price} d={decimales} />
            <Linea k="Costes variables" v={p.variable_costs} d={decimales} />
            <Linea k="Margen de contribución" v={p.contribution_margin} d={decimales} fuerte />
            <Pct k="Margen sobre venta" v={p.contribution_margin_pct} />
            <Pct k="Recargo sobre coste directo" v={p.markup_on_direct_cost_pct} />
            <div className="border-t border-linea pt-2.5"><Linea k="Resultado tras coste completo" v={p.estimated_full_cost_margin} d={decimales} fuerte /></div>
            <Pct k="Sobre venta" v={p.estimated_full_cost_margin_pct} />
          </dl>
        </div>
      )}

      {res.missing_inputs.length > 0 && (
        <div className="rounded-[22px] bg-white p-6 ring-1 ring-linea">
          <p className="text-[13px] font-medium text-niebla">Datos pendientes</p>
          <ul className="mt-3 space-y-2 text-[13px] leading-snug">
            {res.missing_inputs.map((m, i) => (
              <li key={i} className={m.severity === "blocking" ? "text-terracota" : "text-ambar"}>
                {m.severity === "blocking" ? "● " : "○ "}{m.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {res.lines.length > 0 && (
        <details className="group rounded-[22px] bg-white p-6 ring-1 ring-linea">
          <summary className="cursor-pointer list-none text-[14px] font-medium">
            <span className="inline-block transition group-open:rotate-90">›</span> Ver desglose y fórmulas
          </summary>
          <ul className="mt-4 space-y-4">
            {res.lines.map((l, i) => (
              <li key={i} className="text-[13px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{l.name} <span className="font-normal text-niebla">· {GRUPO[l.group]}</span></span>
                  <span className="shrink-0 tabular-nums">{l.amount_portion === null ? "—" : euro(l.amount_portion, 4)}</span>
                </div>
                <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-niebla">{l.formula}</p>
                <p className="mt-1 text-[11.5px] text-niebla">
                  Dato {CALIDAD[l.quality]} · {l.behavior === "variable" ? "variable" : "fijo"} · {l.directness === "direct" ? "directo" : "indirecto"}
                  {l.amount_batch !== null && ` · ${euro(l.amount_batch, 4)} por tanda`}
                </p>
              </li>
            ))}
          </ul>
          {res.assumptions.length > 0 && (
            <div className="mt-5 border-t border-linea pt-4">
              <p className="text-[12px] font-medium text-niebla">Supuestos</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12px] text-niebla">
                {res.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          <p className="mt-4 text-[11px] text-niebla">Motor v{res.calculation_version} · cálculo con decimales exactos; redondeo solo al mostrar.</p>
        </details>
      )}
    </aside>
  );
}

function Linea({ k, v, d, fuerte }: { k: string; v: string | null; d: number; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={fuerte ? "font-medium" : "text-grafito"}>{k}</dt>
      <dd className={`tabular-nums ${fuerte ? "font-semibold" : ""} ${v === null ? "text-niebla" : ""}`}>{v === null ? "pendiente" : euro(v, d)}</dd>
    </div>
  );
}
function Pct({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-grafito">{k}</dt>
      <dd className="tabular-nums text-grafito">{v === null ? "—" : `${numero(v, 1)} %`}</dd>
    </div>
  );
}

// ------------------------------------------------------------------- piezas UI
function Bloque({ titulo, children, onAdd, vacio }: { titulo: string; children?: React.ReactNode; onAdd?: () => void; vacio?: string }) {
  return (
    <section className="rounded-[22px] bg-white p-6 ring-1 ring-linea">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{titulo}</h2>
        {onAdd && !vacio && (
          <button type="button" onClick={onAdd} className="rounded-full bg-crema-2 px-3.5 py-1.5 text-[13px] font-medium hover:bg-linea">
            + Añadir
          </button>
        )}
      </div>
      {vacio ? <p className="mt-2 text-[13px] text-niebla">{vacio}</p> : <div className="mt-4 space-y-3 empty:mt-0">{children}</div>}
    </section>
  );
}

function Fila({ children, onRemove, cols = "lg:grid-cols-4" }: { children: React.ReactNode; onRemove: () => void; cols?: string }) {
  return (
    <div className={`relative grid gap-3 rounded-2xl bg-crema/70 p-4 pr-12 sm:grid-cols-2 ${cols}`}>
      {children}
      <button type="button" onClick={onRemove} aria-label="Quitar" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-niebla hover:bg-white hover:text-tinta">
        ×
      </button>
    </div>
  );
}

function Num({ label, value, onChange, unidad, ayuda }: { label: string; value: string; onChange: (v: string) => void; unidad?: string; ayuda?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-grafito">{label}</span>
      <span className="relative block">
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={`${claseInput} ${unidad ? "pr-14" : ""}`} />
        {unidad && <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[13px] text-niebla">{unidad}</span>}
      </span>
      {ayuda && <span className="mt-1 block text-[11.5px] leading-snug text-niebla">{ayuda}</span>}
    </label>
  );
}

function Txt({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-grafito">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={claseInput} />
    </label>
  );
}

function Sel({ label, value, onChange, children, className = "" }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12px] font-medium text-grafito">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${claseInput} select-chevron appearance-none pr-9`}>
        {children}
      </select>
    </label>
  );
}
