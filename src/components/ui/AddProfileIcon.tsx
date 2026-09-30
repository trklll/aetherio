/**
 * Icono "+" de la tarjeta "Agregar" de la pantalla "¿Quién está viendo?".
 *
 * Glifo relleno (no stroked) tomado de SVG Repo: una cruz de brazos rectos
 * centrada en (512.5, 512.5) sobre una caja 1024x1024, con 128 de grosor de
 * brazo y 955 de span total — o sea, la cruz llena casi toda la caja y deja
 * solo ~35 de aire por lado. Por eso el `size` de abajo no es el tamaño visual
 * de la cruz: es el ancho de la caja, y lo que se ve mide ~0.93 * size.
 *
 * A diferencia del resto de iconos de `ui/` (trazo de 1.75 sobre viewBox 24)
 * este va relleno y con caja 1024, copiado tal cual del original para no
 * arrastrar el error de transcribir 60 decimales de bezier a mano.
 *
 * `currentColor` — el original trae `fill="#000000"` fijo, que sobre el
 * circulo casi negro de `.profile-card-add` seria un agujero negro. Asi hereda
 * el apagado/encendido del card (rgba(255,255,255,0.4) en reposo, 0.7 con
 * foco) sin duplicar la paleta.
 */
export default function AddProfileIcon({ size = 46, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M576.477 448.471l349.649.621c35.346.041 63.967 28.728 63.926 64.074s-28.728 63.967-64.074 63.926l-349.429-.621.194 349.647c.013 35.346-28.63 64.01-63.977 64.023s-64.01-28.63-64.023-63.977l-.195-349.921-349.622-.621C63.58 575.581 34.959 546.894 35 511.548s28.728-63.967 64.074-63.926l349.402.621-.194-349.361c-.013-35.346 28.63-64.01 63.977-64.023s64.01 28.63 64.023 63.977l.194 349.635z" />
    </svg>
  );
}
