export function Avatar({ nombre, size = 40 }: { nombre: string; size?: number }) {
  const ini = nombre.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const tonos = ["bg-musgo", "bg-terracota", "bg-ambar", "bg-grafito", "bg-[#5b6f8a]"];
  let h = 5381;
  for (const c of nombre.trim().toLowerCase()) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  const tono = tonos[h % tonos.length];
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${tono}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {ini}
    </span>
  );
}
