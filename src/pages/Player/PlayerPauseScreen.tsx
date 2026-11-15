import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./PlayerPauseScreen.css";

/**
 * Pantalla de pausa al estilo Netflix.
 *
 * Aparece 3 s despues de que el usuario pausa un medio ya en reproduccion y
 * se retira en cuanto la barra de controles vuelve. Sustituye a los controles,
 * no se superpone: en Netflix es lo que hace y ademas evita que el "Pausado"
 * de la esquina compita con la barra.
 *
 * TODAS las cifras vienen medidas sobre una referencia de 701x438
 * (`artifacts/pause-screen/ANALYSIS.md`). Se escalan por la altura del
 * contenedor -- mpv dibuja sobre una superficie nativa que ocupa la ventana,
 * asi que el contenedor ES el rectangulo del video -- y no por unidades de
 * viewport: si se escalaran por `vh`, un TV 21:9 dejaria el texto pegado al
 * borde izquierdo de la pantalla en vez de al borde del video.
 */

/**
 * Duracion del fade de entrada y de salida. Tiene que coincidir con la de las
 * animaciones en `PlayerPauseScreen.css`: este es el tiempo que el nodo sigue
 * montado durante la salida, y si termina antes que la animacion el overlay se
 * corta a mitad de camino.
 */
const FADE_MS = 280;

/**
 * Lienzo de referencia. La escala sale de dividir la altura real entre esto.
 * 438 = alto del lienzo medido sobre la referencia.
 */
const REF_HEIGHT = 438;

/** Ancho del lienzo de referencia (la referencia medida es 701 x 438). */
const REF_WIDTH = 701;

/** Centro vertical del frame en el lienzo de referencia. */
const BLOCK_CENTER = 219;

/**
 * Tokens.
 *
 * Los `y` NO son coordenadas absolutas del lienzo sino DESPLAZAMIENTOS DESDE
 * EL CENTRO del frame. Asi el bloque se mantiene centrado cuando cambia la
 * escala: multiplicar los desplazamientos y los tamanos por el mismo factor
 * deja el bloque opticamente en el centro, que es como se midio
 * (centro medido 219.5 contra centro de frame 219.0).
 */
/**
 * Reduccion del conjunto.
 *
 * Se aplica AL TODO lo que cuelga de la escala --tipografia, ritmo vertical,
 * ancho de descripcion y margenes-- para que la pantalla se encoja entera y no
 * solo las letras dejando la caja igual. La escala general original (1.5x) y la
 * del logo (1.5x mas) se dejan escritas como estaban para que la reduccion sea
 * reversible leyendo la constante.
 */
const SHRINK = 1.3;

/** Escala general de todo lo demas: la pedida (1,5x) menos la reduccion. */
const S = 1.5 / SHRINK;

/**
 * Multiplicador del LOGO, independiente de `SHRINK` a proposito: el logo no
 * acompana la reduccion del resto y se le ha pedido mas tamano por separado dos
 * veces ("un 1.3x mas, solo el logo" y, despues, "un 1.3x mas"). Lleva su propio
 * 1,5x sobre el general y dos devoluciones de 1,3x: `1,5 x 1,5 x 1,3 x 1,3 =
 * 2,925` de lienzo.
 */
const LOGO_S = 1.5 * 1.5 * 1.3 * 1.3;

/**
 * Huejos medidos entre cajas consecutivas del lienzo original (eyebrow->logo,
 * logo->temporada, temporada->episodio, episodio->descripcion). Se escalan con
 * el factor general: son ritmo vertical, no tamano de glifo.
 */
const GAP = {
  eyebrow: 9.79,
  logo: 7.60,
  season: 15.80,
  desc: 8.44,
} as const;

/**
 * Margen izquierdo de la columna. En la referencia es el 11,3 % del ANCHO del
 * frame (79 px de 701), y multiplicarlo por la escala lo convertia en ~15,4 %
 * a 16:9 -- con la columna de descripcion ancha, el bloque se leia opticamente
 * centrado. 88 px de lienzo devolvian el 11,3 % medido; con la reduccion actual
 * queda en 8,7 %. Ver seccion 12 de artifacts/pause-screen/ANALYSIS.md.
 */
const MARGIN_LEFT = 88 / SHRINK;

/**
 * Margen derecho: el del borde del frame, el mismo que separa "Pausado" de la
 * esquina. La descripcion llega HASTA AQUI, no a un ancho fijo, asi que crece y
 * se encoge con el frame en vez de dejar un columna mas estrecha que el lienzo
 * en pantallas anchas.
 */
const MARGIN_RIGHT = 72 * S;

const T = {
  marginLeft: MARGIN_LEFT,
  marginRight: MARGIN_RIGHT,
  // Pesos y blancos de la escala de Home/Detail (400/500/600/700/750/800 y
  // 0.55/0.6/0.7/0.8/0.82/0.9). El ajuste automatico contra la referencia
  // daba pesos raros (350/450/550) que hacian que las letras se vieran ajenas
  // al resto de la aplicacion.
  eyebrow: { size: 9.2 * S, weight: 500, tracking: -0.02 },
  logo: { size: 33.0 * LOGO_S, weight: 800, tracking: -0.03 },
  season: { size: 13.2 * S, weight: 700, tracking: -0.02 },
  episode: { size: 12.9 * S, weight: 750, tracking: -0.01 },
  desc: { size: 9.7 * S, weight: 400, lineHeight: 12.5 * S },
  // "Pausado" va anclado al borde inferior del frame, no al bloque: su
  // posicion es una fraccion del alto y no se mueve al reescalar.
  paused: { y: 382.56, size: 9.6 * S, weight: 500, tracking: -0.01 },
} as const;

const WHITE_80 = "rgba(255,255,255,0.80)";

/**
 * Ancho disponible para el logo: del inset izquierdo al derecho del frame, con
 * holgura. El logo ya no sigue la reduccion del resto, y a 2,925 de lienzo un
 * titulo largo SIN logo --el caso en que cae el titular de texto-- se sale del
 * frame. El limite se aplica midiendo, no con CSS, porque el ancho natural
 * depende de si hay imagen de logo y de la relacion de aspecto de cada una.
 * Ver seccion 13.3 de artifacts/pause-screen/ANALYSIS.md.
 */
const LOGO_MAX_W = REF_WIDTH - T.marginLeft - T.marginRight - 12;
const WHITE_82 = "rgba(255,255,255,0.82)";
const WHITE_70 = "rgba(255,255,255,0.70)";

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Retrasa `ready` hasta `delayMs` mientras `active` siga siendo verdad.
 * Es el "3 s" del caso de uso: el overlay no aparece de golpe al pausar.
 */
export function usePauseScreenDelay(active: boolean, delayMs = 3000) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    setReady(false);
    const timer = window.setTimeout(() => setReady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return ready;
}

interface PlayerPauseScreenProps {
  visible: boolean;
  /** En escritorio conserva solo el velo oscuro; la información vive en su panel propio. */
  showDetails?: boolean;
  /** Titulo del medio: hace de titular cuando no hay logo. */
  mediumTitle: string;
  /** Logo del medio. Si falta, cae al texto con el mismo estilo. */
  logoUrl?: string | null;
  isSeries: boolean;
  season?: number | null;
  episode?: number | null;
  episodeTitle?: string | null;
  overview?: string | null;
}

export default function PlayerPauseScreen({
  visible,
  showDetails = true,
  mediumTitle,
  logoUrl = null,
  isSeries,
  season,
  episode,
  episodeTitle,
  overview,
}: PlayerPauseScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLParagraphElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const logoFitFor = useRef<string | null>(null);
  const [scale, setScale] = useState(1);
  // Ancho del frame expresado en unidades del lienzo de referencia. Se mide
  // aparte del alto porque en 16:9 (y ultrawide) el video es mas ancho que el
  // lienzo 701x438: la descripcion debe llegar hasta el margen de la pantalla,
  // no quedarse en el ancho de referencia.
  const [frameWidth, setFrameWidth] = useState(REF_WIDTH);
  const [logoFit, setLogoFit] = useState(1);
  const [descLines, setDescLines] = useState(3);
  const [mounted, setMounted] = useState(visible);
  const descWidth = Math.max(0, frameWidth - T.marginLeft - T.marginRight);

  // La escala depende del alto real del contenedor, no de la ventana. El
  // contenedor NO existe hasta que `mounted` es true (el overlay entra con
  // retraso, no con el componente), asi que la dependencia es `mounted`: con
  // `[]` el efecto corria una vez sobre un nodo null y la escala se quedaba en
  // 1 para siempre -- el texto salia a tamano de referencia en cualquier
  // pantalla.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => {
      const nextScale = el.clientHeight / REF_HEIGHT || 1;
      setScale(nextScale);
      setFrameWidth(el.clientWidth / nextScale || REF_WIDTH);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted]);

  // Numero real de lineas de la descripcion: el recentrado depende de el y no
  // se puede suponer a 3 (la descripcion viene del catalogo, cambia cada medio).
  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el || !scale) return;
    const line = T.desc.lineHeight * scale;
    const lines = line > 0 ? Math.round(el.offsetHeight / line) : 3;
    setDescLines(prev => (prev === lines ? prev : Math.max(1, lines)));
  }, [overview, scale, descWidth, isSeries, season, episode, episodeTitle]);

// El logo NO sigue la reduccion del resto y se le ha pedido mas tamano por
  // separado, asi que puede no caber en el ancho que le queda al bloque. Se mide
  // UNA vez por contenido y el factor entra en la cadena de layout (igual que el
  // numero de lineas de la descripcion): encogerlo con `transform` dejaria hueco
  // muerto encima y el bloque se descentraria, porque la cadena reserva la caja
  // sin encoger. Mide el HIJO a tamano completo y con `offsetWidth`: el ancho de
  // la caja viene recortado y cualquier medida de caja traeria el factor ya
  // aplicado, realimentandolo.
  useLayoutEffect(() => {
    const key = `${logoUrl ?? ""}|${mediumTitle}`;
    const measure = () => {
      const inner = logoRef.current?.firstElementChild as HTMLElement | null;
      if (!inner) return;
      logoFitFor.current = key;
      // A lienzo: el ancho natural y el hueco disponible escalan igual, asi que
      // el factor no depende de la escala y no hay que volver a medir al reescalar.
      const natural = inner.offsetWidth / (scale || 1);
      const fit = natural > LOGO_MAX_W && natural > 0 ? LOGO_MAX_W / natural : 1;
      setLogoFit(prev => (Math.abs(fit - prev) < 0.005 ? prev : fit));
    };
    if (logoFitFor.current === key) return;
    measure();
    // El ancho natural cambia cuando cargan las fuentes o la imagen: se vuelve a
    // medir en cuanto pase, y el guard de `logoFitFor` evita medir mas de una vez
    // por contenido.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.ready?.then(() => {
      if (logoFitFor.current !== key) measure();
      const img = logoRef.current?.firstElementChild;
      if (img instanceof HTMLImageElement && !img.complete) {
        img.addEventListener("load", () => {
          if (logoFitFor.current === key) logoFitFor.current = null;
          measure();
        }, { once: true });
      }
    }).catch(() => undefined);
    // `mounted` va en las deps por lo mismo que en el efecto de la escala: el
    // overlay entra con retraso, asi que en el primer render los refs no existen.
  }, [mounted, logoUrl, mediumTitle, scale]);

  // Se mantiene montado durante la salida para que el fade pueda correr: si el
  // nodo desapareciera en el mismo frame en que `visible` pasa a false, la
  // animacion no tendria donde verse. El temporizador dura lo mismo que la
  // animacion (`FADE_MS`).
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!mounted) return null;

  const px = (value: number) => `${(value * scale).toFixed(3)}px`;
  const hasSeason = isSeries && Number.isFinite(Number(season)) && Number.isFinite(Number(episode));
  const hasEpisodeTitle = isSeries && Boolean(episodeTitle);

/**
 * La columna izquierda se arma de arriba abajo con las ALTURAS REALES de cada
 * caja y los huecos medidos, y despues se recentra el conjunto en el frame.
 *
 * No se pueden usar los tops medidos escalados: el logo crece 2.25x mientras
 * el resto crece 1.5x, asi que su caja invade la linea de temporada y los
 * desplazamiento medidos dejan de valer. Encadenando y recentrando, cualquier
 * escala por bloque se resuelve sola -- y de paso el caso de pelicula, que es
 * la misma cadena sin los bloques que no hay.
 */
  const parts: { key: string; size: number; gap: number }[] = [
    { key: "eyebrow", size: T.eyebrow.size, gap: 0 },
    { key: "logo", size: T.logo.size * logoFit, gap: GAP.eyebrow },
    ...(hasSeason ? [{ key: "season", size: T.season.size, gap: GAP.logo }] : []),
    ...(hasEpisodeTitle ? [{ key: "episode", size: T.episode.size, gap: GAP.season }] : []),
  ];

  const layout = new Map<string, number>();
  let cursor = 0;
  for (const part of parts) {
    cursor += part.gap * S;
    layout.set(part.key, cursor);
    cursor += part.size;
  }
  let descTop = cursor + GAP.desc * S;

  const blockTop = 0;
  const blockBottom = descTop + descLines * T.desc.lineHeight;
  const recentre = BLOCK_CENTER - (blockTop + blockBottom) / 2;
  for (const part of parts) layout.set(part.key, layout.get(part.key)! + recentre);
  descTop += recentre;

  const at = (key: string) => layout.get(key)!;

  const pausedLabel = "Pausado";

  return (
    <div
      ref={rootRef}
      data-player-pause-screen
      data-leaving={!visible}
      aria-hidden={!visible}
      className="player-pause-screen pointer-events-none absolute inset-0 z-40 overflow-hidden select-none"
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
        // Sin esto el navegador aplica hinting a estos tamanos y la tinta baja
        // ~15 %: mismo texto, mismo sitio, glifos mas ligeros. Es lo que
        // separa el render del componente del clon aprobado.
        textRendering: "geometricPrecision",
      }}
    >
      {/*
        Velo uniforme: 70 % en Big Picture, donde sostiene el texto sobre video,
        y 50 % en PC, donde el panel de información aporta el contraste y conviene
        dejar más visible la imagen.
      */}
      <div
        data-player-pause-backdrop
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundColor: showDetails ? "rgba(0,0,0,0.70)" : "rgba(0,0,0,0.50)",
        }}
      />

      {showDetails && <div
        className="absolute"
        style={{
          left: px(T.marginLeft),
          top: px(at("eyebrow")),
          width: px(descWidth),
        }}
      >
        <p
          className="absolute m-0 whitespace-nowrap"
          style={{
            top: 0,
            left: 0,
            fontSize: px(T.eyebrow.size),
            fontWeight: T.eyebrow.weight,
            letterSpacing: px(T.eyebrow.tracking),
            lineHeight: 1,
            color: WHITE_80,
            fontVariationSettings: '"opsz" 14',
          }}
        >
          Viendo Ahora
        </p>

        {/* El logo del medio ocupa la caja del titular; sin logo cae al texto. Su
          tamaño es el ajustado: `logoFit` ya entro en la cadena de arriba. */}
        <div
          ref={logoRef}
          className="absolute flex items-end whitespace-nowrap"
          style={{
            top: px(at("logo") - at("eyebrow")),
            left: 0,
            height: px(T.logo.size * logoFit),
            color: "#fff",
          }}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={mediumTitle}
              className="block w-auto shrink-0 object-contain object-left"
              style={{ height: px(T.logo.size * logoFit) }}
            />
          ) : (
            <span
              className="shrink-0"
              style={{
                fontSize: px(T.logo.size * logoFit),
                fontWeight: T.logo.weight,
                letterSpacing: px(T.logo.tracking),
                lineHeight: 1,
                fontVariationSettings: '"opsz" 28',
                textShadow: `0 ${px(1.8)} ${px(18)} rgba(0,0,0,0.55)`,
              }}
            >
              {mediumTitle}
            </span>
          )}
        </div>

        {hasSeason ? (
          <p
            className="absolute m-0 whitespace-nowrap"
            style={{
              top: px(at("season") - at("eyebrow")),
              left: 0,
              fontSize: px(T.season.size),
              fontWeight: T.season.weight,
              letterSpacing: px(T.season.tracking),
              lineHeight: 1,
              color: "#fff",
              fontVariationSettings: '"opsz" 14',
              textShadow: `0 ${px(1.4)} ${px(14)} rgba(0,0,0,0.5)`,
            }}
          >
            Temporada {season}: Ep.{episode}
          </p>
        ) : null}

        {hasEpisodeTitle ? (
          <p
            className="absolute m-0 whitespace-nowrap"
            style={{
              top: px(at("episode") - at("eyebrow")),
              left: 0,
              fontSize: px(T.episode.size),
              fontWeight: T.episode.weight,
              letterSpacing: px(T.episode.tracking),
              lineHeight: 1,
              color: "#fff",
              fontVariationSettings: '"opsz" 14',
              textShadow: `0 ${px(1.4)} ${px(14)} rgba(0,0,0,0.5)`,
            }}
          >
            {episodeTitle}
          </p>
        ) : null}

        {overview ? (
          <p
            ref={descRef}
            data-player-pause-desc
            className="absolute m-0"
            style={{
              top: px(descTop - at("eyebrow")),
              left: 0,
              width: px(descWidth),
              fontSize: px(T.desc.size),
              fontWeight: T.desc.weight,
              lineHeight: px(T.desc.lineHeight),
              color: WHITE_82,
              fontVariationSettings: '"opsz" 14',
              textShadow: `0 ${px(1.2)} ${px(12)} rgba(0,0,0,0.45)`,
            }}
          >
            {overview}
          </p>
        ) : null}
      </div>}

      {showDetails && <p
        data-player-pause-label
        className="absolute m-0 whitespace-nowrap"
        style={{
          right: px(T.marginRight),
          top: px(T.paused.y),
          fontSize: px(T.paused.size),
          fontWeight: T.paused.weight,
          letterSpacing: px(T.paused.tracking),
          lineHeight: 1,
          color: WHITE_70,
          fontVariationSettings: '"opsz" 14',
          textShadow: `0 ${px(1.2)} ${px(12)} rgba(0,0,0,0.45)`,
        }}
      >
        {pausedLabel}
      </p>}
    </div>
  );
}
