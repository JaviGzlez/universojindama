import Link from "next/link";
import { Marca } from "@/components/marca";
import { Mundo, type MundoId } from "@/components/mundo";

const AREAS = [
  ["Compras", "Facturas, proveedores y precios validados."],
  ["Ingredientes", "Unidades, rendimientos y alérgenos."],
  ["Recetas", "Elaboraciones y platos versionados."],
  ["Equipos", "Potencia, consumo y capacidad."],
  ["Personal", "Coste por hora productiva."],
  ["Energía", "Tarifas con vigencia."],
  ["Inventario", "Movimientos, recuentos y mermas."],
  ["Ventas", "Canales, comisiones y márgenes."],
  ["Control económico", "Periodos, gastos y conciliación."],
] as const;

const IDENTIDADES: { id: MundoId; nombre: string; lema: string; texto: string; acento: string }[] = [
  { id: "jindama", nombre: "Jindama", lema: "Origen.", texto: "Donde empezó todo. Sus recetas, sus tiempos, su forma de hacer.", acento: "text-musgo" },
  { id: "jaleo", nombre: "Jaleo", lema: "Ritmo.", texto: "Su propia carta, su sala y sus canales, con sus costes a la vista.", acento: "text-terracota" },
  { id: "juye", nombre: "Juye Burger", lema: "Carácter.", texto: "Producto, fuego y reparto. Cada pedido, con su margen real.", acento: "text-ambar" },
];

export default function Portada() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-crema">
      {/* ---------------------------------------------------------------- nav */}
      <header className="sticky top-0 z-40 border-b border-linea/60 bg-crema/75 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6" aria-label="Principal">
          <Marca />
          <ul className="hidden items-center gap-8 text-[13px] text-grafito md:flex">
            <li><a className="hover:text-tinta" href="#centro">Plataforma</a></li>
            <li><a className="hover:text-tinta" href="#identidades">Restaurantes</a></li>
            <li><a className="hover:text-tinta" href="#inteligencia">Inteligencia</a></li>
          </ul>
          <Link href="/acceso" className="rounded-full px-3 py-1.5 text-[13px] font-medium text-tinta hover:bg-tinta/5">
            Acceder
          </Link>
        </nav>
      </header>

      <main>
        {/* --------------------------------------------------------------- hero */}
        <section className="relative px-6 pt-20 text-center md:pt-28" aria-labelledby="titulo">
          <p className="aparecer text-[13px] font-medium uppercase tracking-[0.18em] text-niebla">Universo Jindama</p>
          <h1 id="titulo" className="aparecer mx-auto mt-5 max-w-4xl text-[44px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-6xl md:text-[84px]" style={{ animationDelay: "80ms" }}>
            Tu negocio.
            <br />
            <span className="font-serif font-normal italic tracking-[-0.02em]">Al siguiente nivel.</span>
          </h1>
          <p className="aparecer mx-auto mt-7 max-w-xl text-lg leading-relaxed text-grafito md:text-xl" style={{ animationDelay: "160ms" }}>
            Todo conectado y bajo control desde un mismo punto.
          </p>

          {/* Universo: tres mundos en órbita alrededor de un único centro */}
          <div className="relative mx-auto mt-14 h-[380px] max-w-5xl sm:h-[460px] md:h-[540px]" aria-hidden="true">
            <div className="absolute left-1/2 top-1/2 h-[300px] w-[92%] -translate-x-1/2 -translate-y-1/2 sm:h-[360px] md:h-[420px]">
              <div className="girar-lento absolute inset-0 rounded-[50%] border border-tinta/10" />
              <div className="girar-lento-inverso absolute inset-[14%] rounded-[50%] border border-dashed border-tinta/10" />
              <div className="girar-lento absolute inset-0">
                <span className="absolute left-[8%] top-[22%] h-1.5 w-1.5 rounded-full bg-terracota/70" />
                <span className="absolute right-[12%] bottom-[18%] h-1 w-1 rounded-full bg-musgo/70" />
                <span className="absolute left-1/2 top-0 h-1 w-1 rounded-full bg-tinta/40" />
              </div>
            </div>
            {/* centro */}
            <div className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 sm:h-24 sm:w-24 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 shadow-[0_20px_50px_-20px_rgba(40,30,20,0.35)] ring-1 ring-linea backdrop-blur">
              <span className="h-3 w-3 rounded-full bg-tinta" />
            </div>
            <div className="flotar-a absolute left-[2%] top-[16%] sm:left-[10%] sm:top-[14%]">
              <Mundo id="jindama" className="h-[104px] w-[104px] sm:h-[190px] sm:w-[190px]" />
            </div>
            <div className="flotar-b absolute right-[2%] top-[8%] sm:right-[10%] sm:top-[6%]">
              <Mundo id="jaleo" className="h-[88px] w-[88px] sm:h-[160px] sm:w-[160px]" />
            </div>
            <div className="flotar-c absolute bottom-[8%] left-[58%] sm:bottom-[2%] sm:left-[54%]">
              <Mundo id="juye" className="h-[80px] w-[80px] sm:h-[140px] sm:w-[140px]" />
            </div>
          </div>
          <ul className="mx-auto mt-8 flex max-w-md justify-center gap-6 text-[13px] font-medium text-grafito">
            <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-musgo" />Jindama</li>
            <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-terracota" />Jaleo</li>
            <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ambar" />Juye Burger</li>
          </ul>
        </section>

        {/* ------------------------------------------------- centro de control */}
        <section id="centro" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-40" aria-labelledby="centro-t">
          <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-musgo">Un único centro de control</p>
          <h2 id="centro-t" className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-6xl">
            Todo lo que mueve tu cocina, <span className="font-serif font-normal italic">conectado.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-grafito">
            Introduces cada dato una vez. Un precio nuevo actualiza la elaboración, el plato y su margen.
            Cada cifra se puede abrir y comprobar.
          </p>
          <ul className="mt-16 grid gap-px overflow-hidden rounded-3xl bg-linea ring-1 ring-linea sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map(([nombre, texto]) => (
              <li key={nombre} className="bg-white/80 p-7">
                <p className="text-[17px] font-semibold tracking-[-0.01em]">{nombre}</p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-niebla">{texto}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------ identidades */}
        <section id="identidades" className="mx-auto max-w-6xl scroll-mt-20 px-6 pt-40" aria-labelledby="id-t">
          <div className="text-center">
            <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-terracota">Tres identidades</p>
            <h2 id="id-t" className="mx-auto mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-6xl">
              Cada casa, la suya. <span className="font-serif font-normal italic">Un mismo universo.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-grafito">
              Cada restaurante conserva sus precios, equipos, tarifas y reglas. El grupo lo ve todo junto, con permisos
              independientes.
            </p>
          </div>
          <ul className="mt-16 grid gap-5 md:grid-cols-3">
            {IDENTIDADES.map((r, i) => (
              <li key={r.id} className="flex flex-col items-center rounded-[28px] bg-white px-8 pb-10 pt-12 text-center ring-1 ring-linea">
                <div className={i === 0 ? "flotar-a" : i === 1 ? "flotar-b" : "flotar-c"}>
                  <Mundo id={r.id} size={150} />
                </div>
                <h3 className="mt-10 text-2xl font-semibold tracking-[-0.02em]">{r.nombre}</h3>
                <p className={`mt-1 font-serif text-xl italic ${r.acento}`}>{r.lema}</p>
                <p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-niebla">{r.texto}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------ inteligencia */}
        <section id="inteligencia" className="scroll-mt-20 px-6 pt-40" aria-labelledby="ia-t">
          <div className="mx-auto max-w-6xl rounded-[36px] bg-tinta px-8 py-20 text-crema md:px-16 md:py-28">
            <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-crema/60">Inteligencia al servicio del negocio</p>
            <h2 id="ia-t" className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-6xl">
              La IA ayuda. <span className="font-serif font-normal italic text-[#e8c9a8]">Las cuentas, exactas.</span>
            </h2>
            <ol className="mt-16 grid gap-10 md:grid-cols-3">
              {[
                ["01", "La IA propone.", "Lee facturas, prepara borradores de recetas y señala lo que falta."],
                ["02", "El motor calcula.", "Fórmulas deterministas y decimales exactos. Nada se inventa."],
                ["03", "Tú decides.", "Nada se aplica sin tu validación. Todo queda registrado."],
              ].map(([n, t, d]) => (
                <li key={n} className="border-t border-crema/15 pt-6">
                  <span className="font-mono text-xs text-crema/50">{n}</span>
                  <p className="mt-3 text-2xl font-semibold tracking-[-0.02em]">{t}</p>
                  <p className="mt-3 text-[15px] leading-relaxed text-crema/70">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------ acceso */}
        <section className="px-6 py-40 text-center" aria-labelledby="acceso-t">
          <div className="mx-auto flex w-fit items-center -space-x-4" aria-hidden="true">
            <Mundo id="jindama" size={56} />
            <Mundo id="jaleo" size={56} />
            <Mundo id="juye" size={56} />
          </div>
          <h2 id="acceso-t" className="mx-auto mt-10 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-6xl">
            Todo bajo control. <span className="font-serif font-normal italic">Desde aquí.</span>
          </h2>
          <Link
            href="/acceso"
            className="mt-12 inline-flex h-14 items-center rounded-full bg-tinta px-9 text-[17px] font-medium text-crema shadow-[0_18px_40px_-18px_rgba(29,29,31,0.7)] transition hover:bg-grafito active:scale-[0.98]"
          >
            Acceder al universo
          </Link>
        </section>
      </main>

      <footer className="border-t border-linea/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-[12px] text-niebla sm:flex-row">
          <Marca />
          <p>© {new Date().getFullYear()} Universo Jindama</p>
        </div>
      </footer>
    </div>
  );
}
