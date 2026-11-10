/**
 * Icono de Buscar para el rail de Big Picture.
 *
 * Lupa de SVG Repo (`search-thin.svg`): circulo de radio 8 con mango a 45
 * grados. Se refuerza el trazo sobre el viewBox 24 para igualar el peso de los
 * iconos de Lucide en la fila.
 *
 * A diferencia de `Search` de lucide, este trae el trazo ya puesto en el
 * `path` (no en el `svg`), asi que el `strokeWidth` del `<svg>` no lo pisa.
 * Se respeta tal cual para no re-dibujar el glifo.
 *
 * Mismo contrato que `LibraryIcon` / `SportsIcon`: `size` en px y
 * `aria-hidden`, porque el nombre siempre lo pone el texto que lo acompana.
 */
export default function SearchThinIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21l-4.343-4.343m0 0A8 8 0 1 0 5.343 5.343a8 8 0 0 0 11.314 11.314"
      />
    </svg>
  );
}
