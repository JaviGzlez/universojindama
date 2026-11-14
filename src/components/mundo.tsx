export type MundoId = "jindama" | "jaleo" | "juye";

const CLASES: Record<MundoId, string> = {
  jindama: "mundo-jindama",
  jaleo: "mundo-jaleo",
  juye: "mundo-juye",
};

/** Esfera de material orgánico/mineral. Decorativa: el nombre se escribe fuera. */
export function Mundo({ id, size, className = "" }: { id: MundoId; size?: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`mundo ${CLASES[id]} ${className}`}
      style={size ? { width: size, height: size } : undefined}
    />
  );
}

export function mundoDeSlug(slug: string): MundoId {
  if (slug.startsWith("jaleo")) return "jaleo";
  if (slug.startsWith("juye")) return "juye";
  return "jindama";
}

/** Color de cada universo con contraste suficiente sobre blanco (menús, etiquetas). */
export const COLOR_MUNDO: Record<MundoId, string> = { jindama: "#4f6b4a", jaleo: "#b0532f", juye: "#8a5a1c" };
