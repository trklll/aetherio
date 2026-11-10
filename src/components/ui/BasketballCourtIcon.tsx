/** Icono de cancha de baloncesto para la navegación de Deportes. */
export default function BasketballCourtIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.78">
        <path
          d="M29 25H3c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2h26c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2Z"
        />
        <circle cx="16" cy="16" r="3" />
        <path d="M16 7v18" />
        <path d="M1 10c3.3 0 6 2.7 6 6s-2.7 6-6 6" />
        <path d="M31 22c-3.3 0-6-2.7-6-6s2.7-6 6-6" />
      </g>
    </svg>
  );
}
