import Link from "next/link";

/** Marca tipográfica propia: un anillo orbital y el nombre. */
export function Marca({ href = "/", compacta = false }: { href?: string; compacta?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5 text-tinta" aria-label="Universo Jindama, inicio">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" />
        <ellipse cx="12" cy="12" rx="10.5" ry="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" transform="rotate(-24 12 12)" opacity="0.55" />
        <circle cx="21" cy="8.6" r="1.4" fill="var(--color-terracota)" />
      </svg>
      {!compacta && (
        <span className="text-[15px] font-semibold tracking-[-0.01em]">
          Universo <span className="font-serif font-normal italic">Jindama</span>
        </span>
      )}
    </Link>
  );
}
