import { RotateCw, Signal } from "lucide-react";

/**
 * Insignia de directo persistente. A diferencia del OSD de play/pausa, esta no
 * desaparece: en un directo es la unica referencia continua de que lo que se ve
 * es "ahora" y no una grabacion.
 */
export function LiveBadge({
  atEdge,
  latencySeconds,
  playing,
  lightBackground,
}: {
  atEdge: boolean;
  latencySeconds: number;
  playing: boolean;
  lightBackground: boolean;
}) {
  const behind = Math.max(0, latencySeconds);
  return (
    <div
      data-player-live-badge
      className="pointer-events-none absolute left-5 top-5 z-30 flex items-center gap-2"
    >
      <span
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wider shadow-lg ${
          playing ? "bg-red-600 text-white" : "bg-black/80 text-white/80"
        }`}
      >
        <span className="relative flex h-1.5 w-1.5">
          {playing ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          ) : null}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        Directo
      </span>
      {!atEdge ? (
        <span
          className={`rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums shadow-lg ${
            lightBackground ? "bg-black/70 text-white/85" : "bg-black/60 text-white/75"
          }`}
        >
          -{behind < 10 ? behind.toFixed(1) : Math.round(behind)}s
        </span>
      ) : null}
    </div>
  );
}

/**
 * `eof-reached` en un stream en vivo significa que el host corto la
 * transmision. Sin esto el reproductor se queda congelado en el ultimo frame y
 * parece un fallo de red, cuando en realidad no hay nada mas que reproducir.
 */
export function LiveEndedNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-player-live-ended
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/72 px-6 backdrop-blur-sm"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Signal size={30} className="text-white/35" />
        <p className="text-base font-semibold text-white/92">Fin de la transmision</p>
        <p className="text-sm leading-relaxed text-white/55">
          La fuente ha dejado de emitir. Puede que el evento haya terminado o que el
          proveedor haya cerrado la conexion.
        </p>
        <button
          type="button"
          onClick={onRetry}
          data-player-interactive
          className="mt-1 inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white gsap-transition hover:bg-white/16"
        >
          <RotateCw size={15} />
          Reintentar conexion
        </button>
      </div>
    </div>
  );
}
