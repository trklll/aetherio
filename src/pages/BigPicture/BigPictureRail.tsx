import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Home, Plug, Search, Settings, Users } from "lucide-react";
import {
  getActiveProfile,
  getProfileInitial,
  LOCAL_PROFILES_CHANGED_EVENT,
  type LocalProfile,
} from "../../utils/localProfiles";
import { OPEN_PICTURE_RAIL_EVENT } from "../../navigation/spatialNav.ts";
import { isContextMenuOpen } from "../../components/ui/ContextMenu.tsx";
import { clearPendingShellPreview } from "../../store/shellPreviewStore.ts";
import "./BigPictureRail.css";

/**
 * Port literal del TvPagePill nativo (TvPagePill.kt) al modo picture web.
 *
 * Tokens del nativo escalados 1.2x en modo picture:
 * - Rail 276px → item 60px → gap 8px → padding 13px → perfil 62px
 * - Colapsado: pill 53px (icono 38px + etiqueta), radio full
 * - Expandido: radio 31px, indicador blanco #F6F6F7, overlay #080A0E 38%
 * - Items: Buscar / Inicio / Party / Ajustes / Extensiones
 *
 * Party es ruta (/big-picture/party, page 10-foot con teclado en pantalla),
 * no modal: el modal de Home es patrón PC (ratón + teclado físico).
 */
interface RailItem {
  key: string;
  label: string;
  /**
   * `ComponentType` y no `typeof Home`: los iconos de lucide son
   * `forwardRef` (con `$$typeof`), pero un SVG propio es un componente de
   * función normal. Este tipo acepta ambos sin castear.
   */
  Icon: ComponentType<{ size?: number; className?: string }>;
  route: string;
}

const RAIL_ITEMS: readonly RailItem[] = [
  { key: "search", route: "/big-picture/search", label: "Buscar", Icon: Search },
  { key: "home", route: "/big-picture", label: "Inicio", Icon: Home },
  { key: "party", route: "/big-picture/party", label: "Party", Icon: Users },
  { key: "settings", route: "/big-picture/settings", label: "Ajustes", Icon: Settings },
  { key: "addons", route: "/big-picture/addons", label: "Extensiones", Icon: Plug },
];

// Tokens nativos × 1.2 (ver TvPagePill.kt: 230 / 11 / 52 / 7 / 50).
const RAIL_W = 276;
const RAIL_PAD = 13;
const RAIL_PROFILE_H = 62;
const RAIL_GAP = 8;
const RAIL_ITEM_H = 60;
const RAIL_OPEN_H =
  RAIL_PAD + RAIL_PROFILE_H + RAIL_GAP +
  RAIL_ITEMS.length * (RAIL_ITEM_H + RAIL_GAP) + RAIL_PAD;

function formatClock(): string {
  try {
    return new Intl.DateTimeFormat("es-PE", {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return "";
  }
}

export default function BigPictureRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(() => getActiveProfile());
  const [clock, setClock] = useState(() => formatClock());
  const [collapsedW, setCollapsedW] = useState(0);
  const collapsedMeasureRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Igual que la TopNav normal (collapsed = scrolled && !hovering): al
  // scrollear fuera del hero la pill se contrae al círculo del icono y luego
  // se aparca fuera de pantalla (izquierda). Volver = animación al revés:
  // entra desde la izquierda y se expande.
  const [pastHero, setPastHero] = useState(false);
  const contracted = pastHero && !expanded;
  // Círculo contraído: icono 38 + paddings 6/6 + borde 2.
  const CONTRACTED_PILL_W = 52;
  // Aparcado tras contraer (da tiempo a la contracción: 0.38s de width).
  const [parkedBase, setParkedBase] = useState(false);
  // Borde izquierdo: asoma la pill aparcada sin abrir el menú.
  const [edgeZone, setEdgeZone] = useState(false);
  const edgeHideTimerRef = useRef<number | null>(null);
  // Oculta del layout de foco una vez fuera de pantalla (el deslizamiento
  // sí se ve; el visibility solo entra al final para no cortarlo).
  const [concealed, setConcealed] = useState(false);
  const parked = parkedBase && !expanded && !edgeZone;

  // En el detalle y en cualquier subpage se resalta Inicio (su página madre):
  // el detalle es el mismo DetailPage de PC, solo cambia el chrome a sidebar.
  // El fallback final NO puede ser el índice 0 ("Buscar"): cualquier ruta no
  // mapada —/big-picture/entity/…, /big-picture/person/…, /big-picture/addons/…
  //— habría etiquetado la pill con "Buscar" siendo la home la activa.
  const activeIndex = (() => {
    const exact = RAIL_ITEMS.findIndex(item => item.route === location.pathname);
    if (exact >= 0) return exact;
    return Math.max(0, RAIL_ITEMS.findIndex(item => item.key === "home"));
  })();
  const indicatorIndex = cursor ?? activeIndex;
  const collapsedItem = RAIL_ITEMS[activeIndex];
  const CollapsedIcon = collapsedItem.Icon;

  // Ancho real de la pill colapsada (como el nativo mide collapsedContentWidth).
  // Se re-mide tras cargar las fuentes para no truncar la etiqueta.
  useLayoutEffect(() => {
    const measure = () => {
      const el = collapsedMeasureRef.current;
      // +2px por el borde de 1px de la caja (box-sizing: border-box).
      if (el) setCollapsedW(Math.ceil(el.getBoundingClientRect().width) + 2);
    };
    measure();
    let disposed = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!disposed) measure();
      }).catch(() => undefined);
    }
    window.addEventListener("resize", measure);
    return () => {
      disposed = true;
      window.removeEventListener("resize", measure);
    };
  }, [collapsedItem.label]);

  useEffect(() => {
    const refresh = () => setProfile(getActiveProfile());
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Reloj es-PE como el nativo (refresco cada 30s).
  useEffect(() => {
    const t = window.setInterval(() => setClock(formatClock()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Scroll del shell de Big Picture: pasado el hero (misma idea que el
  // umbral 220px de TopNav/AppShell, pero medido contra el banner real).
  useEffect(() => {
    let raf = 0;
    function readPastHero(): boolean {
      // Detail trae su propio shell interior (igual que en PC con
      // AppShell): el scroll real puede estar en cualquiera, se lee el max.
      const shells = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-aetherio-big-picture] [data-aetherio-scroll-shell]",
        ),
      );
      if (!shells.length) return false;
      const shell = shells[0];
      const scrollTop = Math.max(...shells.map(s => s.scrollTop));
      // Hero del home picture o hero del Detail de PC reutilizado.
      const hero = document.querySelector<HTMLElement>(
        "[data-aetherio-big-picture] [data-hero-panel], [data-aetherio-big-picture] .detail-page-hero",
      );
      // Search, Party, Genre, Settings y Addons Big Picture no tienen
      // hero: la pill se aparca en cuanto se scrollea (si no, queda
      // flotando sobre tabs/contenido).
      if (!hero) {
        const isSubPage =
          document.querySelector("[data-aetherio-big-picture] [data-bp-search-kb]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-party]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-genre]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-settings]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-addons]") !== null;
        return scrollTop > (isSubPage ? 40 : 220);
      }
      const heroBottom = hero.getBoundingClientRect().bottom;
      const shellTop = shell.getBoundingClientRect().top;
      return heroBottom - shellTop <= 8;
    }
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setPastHero(prev => {
          const next = readPastHero();
          return prev === next ? prev : next;
        });
      });
    }
    document.addEventListener("scroll", onScroll, { capture: true, passive: true } as AddEventListenerOptions);
    window.addEventListener("resize", onScroll);
    const t1 = window.setTimeout(onScroll, 50);
    const t2 = window.setTimeout(onScroll, 250);
    onScroll();
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Fase 2: aparcar fuera de pantalla una vez contraída.
  useEffect(() => {
    if (!contracted) {
      setParkedBase(false);
      return;
    }
    const t = window.setTimeout(() => setParkedBase(true), 420);
    return () => window.clearTimeout(t);
  }, [contracted]);

  // Fase 3: ocultar del foco/tab solo cuando ya está fuera (no corta el slide).
  useEffect(() => {
    if (!parked) {
      setConcealed(false);
      return;
    }
    const t = window.setTimeout(() => setConcealed(true), 500);
    return () => window.clearTimeout(t);
  }, [parked]);

  // Borde izquierdo del ratón: asoma la pill aparcada (peek, sin expandir).
  useEffect(() => {
    function scheduleEdgeHide() {
      if (edgeHideTimerRef.current !== null) window.clearTimeout(edgeHideTimerRef.current);
      edgeHideTimerRef.current = window.setTimeout(() => setEdgeZone(false), 500);
    }
    function onMouseMove(event: MouseEvent) {
      if (event.clientX < 72) {
        if (edgeHideTimerRef.current !== null) {
          window.clearTimeout(edgeHideTimerRef.current);
          edgeHideTimerRef.current = null;
        }
        setEdgeZone(prev => (prev ? prev : true));
      } else {
        setEdgeZone(prev => {
          if (prev) scheduleEdgeHide();
          return prev;
        });
      }
    }
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove, { passive: true } as AddEventListenerOptions);
      if (edgeHideTimerRef.current !== null) window.clearTimeout(edgeHideTimerRef.current);
    };
  }, []);



  const expand = () => {
    if (expanded) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setCursor(activeIndex);
    setExpanded(true);
  };

  const collapse = () => {
    if (!expanded) return;
    setExpanded(false);
    setCursor(null);
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (restore && document.contains(restore)) {
      window.setTimeout(() => restore.focus({ preventScroll: true }), 120);
    }
  };

  // Al expandir, foco al item actual (como el nativo tras 130ms).
  useEffect(() => {
    if (!expanded) return;
    const t = window.setTimeout(() => {
      itemRefs.current[cursor ?? activeIndex]?.focus({ preventScroll: true });
    }, 130);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Escape en captura: si el rail está abierto, lo cierra y consume el evento
  // para que BigPicturePage no salga a /home (prioridad como el BackHandler nativo).
  // La apertura con flecha izquierda la posee el motor espacial (borde sin
  // vecino -> open-rail, como el scaffold nativo); aquí solo se escucha.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expanded) {
        // Con menú contextual abierto, B lo cierra a él (su handler en
        // captura de document lo consume); el rail espera su turno.
        if (isContextMenuOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        collapse();
      }
    };
    const onOpen = () => expand();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_PICTURE_RAIL_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_PICTURE_RAIL_EVENT, onOpen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const go = (item: RailItem) => {
    collapse();
    if (item.route === location.pathname) return;
    // Ir explícitamente al home vía rail no restaura el carrusel (solo el back
    // desde el detail vuelve al carrusel).
    if (item.route === "/big-picture") clearPendingShellPreview();
    navigate(item.route);
  };

  const onRailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = ((cursor ?? activeIndex) + dir + RAIL_ITEMS.length) % RAIL_ITEMS.length;
      setCursor(next);
      itemRefs.current[next]?.focus({ preventScroll: true });
    } else if (e.key === "Home") {
      e.preventDefault();
      setCursor(0);
      itemRefs.current[0]?.focus({ preventScroll: true });
    } else if (e.key === "End") {
      e.preventDefault();
      setCursor(RAIL_ITEMS.length - 1);
      itemRefs.current[RAIL_ITEMS.length - 1]?.focus({ preventScroll: true });
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // Como el nativo: izquierda/derecha cierra el rail y devuelve el foco al contenido.
      e.preventDefault();
      collapse();
    }
  };

  return (
    <>
      {expanded && (
        <div
          className="bp-rail__overlay"
          aria-hidden="true"
          onClick={collapse}
        />
      )}
      <nav
        className="bp-rail"
        aria-label="Navegación espacial"
        aria-hidden={concealed && !expanded}
        style={{ visibility: concealed && !expanded ? "hidden" : "visible" }}
        onMouseEnter={expand}
        onMouseLeave={collapse}
        onKeyDown={onRailKeyDown}
      >
        {/* Medida invisible de la pill colapsada */}
        <div ref={collapsedMeasureRef} className="bp-rail__measure" aria-hidden="true">
          <span className="bp-rail__collapsed-icon">
            <CollapsedIcon size={20} />
          </span>
          <span className="bp-rail__collapsed-label">{collapsedItem.label}</span>
        </div>

        <div
          className={`bp-rail__box${expanded ? " is-expanded" : ""}${parked ? " is-parked" : ""}`}
          style={{
            width: expanded ? RAIL_W : contracted ? CONTRACTED_PILL_W : collapsedW || "auto",
            height: expanded ? RAIL_OPEN_H : 53,
          }}
        >
          {!expanded && (
            <button
              className={`bp-rail__collapsed${contracted ? " is-contracted" : ""}`}
              onClick={expand}
              onFocus={expand}
              aria-label={`Abrir navegación, sección actual: ${collapsedItem.label}`}
            >
              <span className="bp-rail__collapsed-icon">
                <CollapsedIcon size={20} />
              </span>
              <span className={`bp-rail__collapsed-label${contracted ? " is-contracted" : ""}`}>{collapsedItem.label}</span>
            </button>
          )}

          <div className={`bp-rail__expanded${expanded ? " is-visible" : ""}`} aria-hidden={!expanded}>
            {/* Indicador blanco animado (pill de foco) */}
            <div
              className="bp-rail__indicator"
              style={{ top: RAIL_PAD + RAIL_PROFILE_H + RAIL_GAP + indicatorIndex * (RAIL_ITEM_H + RAIL_GAP) }}
            />
            {/* Perfil + reloj */}
            <div className="bp-rail__profile">
              <span className="bp-rail__avatar">
                {profile?.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt="" />
                ) : (
                  <span>{getProfileInitial(profile)}</span>
                )}
              </span>
              <span className="bp-rail__profile-name">{profile?.name?.trim() || "Perfil"}</span>
              <span className="bp-rail__clock">{clock}</span>
            </div>
            {/* Items */}
            {RAIL_ITEMS.map((item, i) => {
              const focused = indicatorIndex === i;
              const ItemIcon = item.Icon;
              return (
                <button
                  key={item.key}
                  ref={el => {
                    itemRefs.current[i] = el;
                  }}
                  className={`bp-rail__item${focused ? " is-focused" : ""}`}
                  tabIndex={expanded ? 0 : -1}
                  onFocus={() => setCursor(i)}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(item)}
                  aria-current={i === activeIndex ? "page" : undefined}
                >
                  <span className="bp-rail__item-icon">
                    <ItemIcon size={26} />
                  </span>
                  <span className="bp-rail__item-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
