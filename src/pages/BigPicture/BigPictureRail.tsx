import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { SlidersHorizontal } from "@phosphor-icons/react";
import BasketballCourtIcon from "../../components/ui/BasketballCourtIcon.tsx";
import LibraryIcon from "../../components/ui/LibraryIcon.tsx";
import SearchThinIcon from "../../components/ui/SearchThinIcon.tsx";
import HomeBoldIcon from "../../components/ui/HomeBoldIcon.tsx";
import { getStreamingPlatformPath, STREAMING_PLATFORMS } from "../../services/streamingPlatforms";
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
 * - Items principales + sección Plataformas (logos y rutas del catálogo)
 *
 * Party es ruta (/big-picture/party, page 10-foot con teclado en pantalla),
 * no modal: el modal de Home es patrón PC (ratón + teclado físico).
 *
 * Biblioteca es ruta (/big-picture/library): su propia page 10-foot con la
 * navegación de secciones que usa el rail de la Library de referencia
 * (artifacts/bp-library/ANALYSIS.md).
 */
export interface RailItem {
  key: string;
  label: string;
  /**
   * `ComponentType` y no `typeof Users`: los iconos de lucide son
   * `forwardRef` (con `$$typeof`), pero un SVG propio es un componente de
   * función normal. Este tipo acepta ambos sin castear.
   */
  Icon?: ComponentType<{ size?: number; className?: string }>;
  route: string;
  logoImage?: string;
  iconSize?: number;
  collapsedLabel?: string;
}

const PRIMARY_RAIL_ITEMS: readonly RailItem[] = [
  { key: "search", route: "/big-picture/search", label: "Buscar", Icon: SearchThinIcon },
  { key: "home", route: "/big-picture", label: "Inicio", Icon: HomeBoldIcon },
  { key: "library", route: "/big-picture/library", label: "Biblioteca", Icon: LibraryIcon, iconSize: 22 },
  { key: "party", route: "/big-picture/party", label: "Party", Icon: Users },
  { key: "settings", route: "/big-picture/settings", label: "Configuración", Icon: SlidersHorizontal },
  ...(import.meta.env.DEV ? [{ key: "sports", route: "/big-picture/sports", label: "Deportes", Icon: BasketballCourtIcon }] : []),
];
const PLATFORM_RAIL_ITEMS: readonly RailItem[] = STREAMING_PLATFORMS.map(platform => ({
  key: `platform-${platform.id}`,
  route: getStreamingPlatformPath(platform.id, true),
  label: platform.name,
  logoImage: platform.logoImage,
}));

// Tokens nativos × 1.2 (ver TvPagePill.kt: 230 / 11 / 52 / 7 / 50).
const RAIL_W = 300;
const RAIL_PAD = 14;
const RAIL_PROFILE_H = 68;
const RAIL_GAP = 9;
const RAIL_ITEM_H = 66;
const RAIL_ICON_SIZE = 26;
const PLATFORM_ITEM_H = 53;
const PLATFORM_ITEM_GAP = 5;
const PLATFORM_SECTION_H = 53;
function getRailItemOffset(index: number, sectionStartIndex: number): number {
  if (index < sectionStartIndex) return index * (RAIL_ITEM_H + RAIL_GAP);
  return (
    sectionStartIndex * (RAIL_ITEM_H + RAIL_GAP) +
    PLATFORM_SECTION_H +
    (index - sectionStartIndex) * (PLATFORM_ITEM_H + PLATFORM_ITEM_GAP)
  );
}

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

export default function BigPictureRail({
  items = PRIMARY_RAIL_ITEMS,
  showProfile = true,
  showPlatforms = true,
  sectionTitle: customSectionTitle,
  sectionItems: customSectionItems = [],
  label = "Navegación espacial",
  onNavigate,
}: {
  items?: readonly RailItem[];
  showProfile?: boolean;
  showPlatforms?: boolean;
  sectionTitle?: string;
  sectionItems?: readonly RailItem[];
  label?: string;
  profileRoute?: string;
  onNavigate?: (route: string) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const visibleItems = items.filter(item => item.key !== "downloads");
  const sectionTitle = showPlatforms ? "Plataformas" : customSectionTitle;
  const sectionItems = showPlatforms ? PLATFORM_RAIL_ITEMS : customSectionItems;
  const railItems = sectionTitle ? [...visibleItems, ...sectionItems] : visibleItems;
  const sectionStartIndex = visibleItems.length;
  const sectionMenuHeight = sectionTitle
    ? PLATFORM_SECTION_H + sectionItems.length * PLATFORM_ITEM_H
      + Math.max(0, sectionItems.length - 1) * PLATFORM_ITEM_GAP
    : -RAIL_GAP;
  const railOpenHeight = RAIL_PAD * 2
    + (showProfile ? RAIL_PROFILE_H + RAIL_GAP : 0)
    + visibleItems.length * (RAIL_ITEM_H + RAIL_GAP)
    + sectionMenuHeight;
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState<number | "profile" | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(() => getActiveProfile());
  const [clock, setClock] = useState(() => formatClock());
  const [collapsedW, setCollapsedW] = useState(0);
  const collapsedMeasureRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Igual que la TopNav normal (collapsed = scrolled && !hovering): al
  // scrollear fuera del hero la pill se contrae al círculo del icono y luego
  // se aparca fuera de pantalla (izquierda). Volver = animación al revés:
  // entra desde la izquierda y se expande.
  const [pastHero, setPastHero] = useState(false);
  const contracted = pastHero && !expanded;
  // Círculo contraído más borde exterior de la píldora.
  const CONTRACTED_PILL_W = 50;
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
    const currentRoute = location.pathname + location.search + location.hash;
    const exact = railItems.findIndex(item => item.route === currentRoute);
    if (exact >= 0) return exact;
    const pathMatch = railItems.findIndex(item => item.route === location.pathname);
    if (pathMatch >= 0) return pathMatch;
    return Math.max(0, railItems.findIndex(item => item.key === "home"));
  })();
  const cursorIndex = typeof cursor === "number" ? cursor : null;
  const indicatorIndex = cursor === "profile" ? null : cursorIndex ?? activeIndex;
  const collapsedItem = railItems[activeIndex];
  const collapsedLabel = collapsedItem.collapsedLabel ?? collapsedItem.label;
  const CollapsedIcon = collapsedItem.Icon;

  // Ancho real de la pill colapsada (como el nativo mide collapsedContentWidth).
  // Se re-mide tras cargar las fuentes para no truncar la etiqueta.
  useLayoutEffect(() => {
    const measure = () => {
      const el = collapsedMeasureRef.current;
      if (el) {
        // +2px por el borde de 1px de la caja (box-sizing: border-box).
        // +4px de holgura: el redondeo sub-píxel del reparto flex dejaba la
        // etiqueta entre 0.6 y 1.5px más corta de lo que el texto necesita, y
        // Chrome pintaba "Bibliote…" / "Extensiones…" en la pill (medido en
        // artifacts/bp-library/measure/rail-labels.mjs, 15 de 18 combinaciones
        // de ruta y ancho). Sin holgura, cualquier etiqueta larga pierde su
        // último glifo.
        const icon = el.querySelector<HTMLElement>(".bp-rail__collapsed-icon");
        const text = el.querySelector<HTMLElement>(".bp-rail__collapsed-label");
        const contentWidth = (icon?.getBoundingClientRect().width ?? 0)
          + (text?.scrollWidth ?? 0);
        setCollapsedW(Math.ceil(contentWidth) + 18);
      }
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
  }, [collapsedLabel]);

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
        "[data-aetherio-big-picture] [data-hero-panel], [data-aetherio-big-picture] .detail-page-hero, [data-aetherio-big-picture] .bp-sports__hero",
      );
      // Search, Library, Party, Genre, Settings y Addons Big Picture no tienen
      // hero: la pill se aparca en cuanto se scrollea (si no, queda
      // flotando sobre tabs/contenido). Sports sí mide su hero propio
      // (.bp-sports__hero); solo entra en este renglón cuando muestra el
      // onboarding, que no tiene hero (raíz con data-bp-sports).
      if (!hero) {
        const isSubPage =
          document.querySelector("[data-aetherio-big-picture] [data-bp-search-kb]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-library]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-downloads]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-sports]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-party]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-genre]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-settings]") !== null ||
          document.querySelector("[data-aetherio-big-picture] [data-bp-addons]") !== null;
        return scrollTop > (isSubPage ? 40 : 220);
      }
      const heroBottom = hero.getBoundingClientRect().bottom;
      const shellTop = shell.getBoundingClientRect().top;
      const isHome =
        location.pathname === "/big-picture" || location.pathname === "/big-picture/";
      if (isHome) {
        const continueWatchingRow = document.querySelector<HTMLElement>(
          '[data-aetherio-big-picture] [data-row-key="continue-watching"]',
        );
        if (continueWatchingRow) {
          return continueWatchingRow.getBoundingClientRect().top - shellTop <= 220;
        }
      }
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
  }, [location.pathname]);

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
      restore.focus({ preventScroll: true });
    }
  };

  const focusRailItem = (index: number) => {
    const item = itemRefs.current[index];
    const menu = menuRef.current;
    if (!item || !menu) return;

    item.focus({ preventScroll: true });
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < menu.scrollTop) {
      menu.scrollBy({ top: itemTop - menu.scrollTop, behavior: "smooth" });
    } else if (itemBottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollBy({
        top: itemBottom - menu.scrollTop - menu.clientHeight,
        behavior: "smooth",
      });
    }
  };

  // Focus is behavioral, not the end of the visual expansion: a quick right
  // press must close the rail, not move the programme still focused behind it.
  useLayoutEffect(() => {
    if (!expanded) return;
    focusRailItem(cursorIndex ?? activeIndex);
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
    if (item.route === location.pathname + location.search + location.hash) return;
    // Ir explícitamente al home vía rail no restaura el carrusel (solo el back
    // desde el detail vuelve al carrusel).
    if (item.route === "/big-picture") clearPendingShellPreview();
    if (onNavigate) onNavigate(item.route);
    else navigate(item.route);
    // Con mando el item activado queda enfocado y el rail ya colapsado lo
    // oculta: el motor ignora teclas dentro de `.bp-rail`, así que la page
    // destino ve el mando completamente muerto (Up/Down absorben las flechas
    // moviendo el foco por items invisibles y Left no reabre nada). El restore de collapse() sirve
    // dentro de la misma page; al cambiar de ruta su elemento ya se desmontó
    // y no hay a quién devolverlo. Solo queda soltar el foco: body despierta
    // al requester de la page destino (el suyo o el del motor a 380 ms).
    window.setTimeout(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest(".bp-rail")) active.blur();
    }, 160);
  };

  const onRailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (document.activeElement === profileButtonRef.current) {
        if (e.key === "ArrowDown") {
          setCursor(0);
          focusRailItem(0);
        }
        return;
      }

      const currentIndex = cursorIndex ?? activeIndex;
      if (showProfile && e.key === "ArrowUp" && currentIndex === 0) {
        setCursor("profile");
        profileButtonRef.current?.focus({ preventScroll: true });
        return;
      }

      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (currentIndex + dir + railItems.length) % railItems.length;
      setCursor(next);
      focusRailItem(next);
    } else if (e.key === "Home") {
      e.preventDefault();
      setCursor(0);
      focusRailItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setCursor(railItems.length - 1);
      focusRailItem(railItems.length - 1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // Como el nativo: izquierda/derecha cierra el rail y devuelve el foco al contenido.
      e.preventDefault();
      collapse();
    }
  };

  const renderRailItem = (item: RailItem, index: number) => {
    const focused = indicatorIndex === index;
    const ItemIcon = item.Icon;
    const isSectionItem = index >= sectionStartIndex;
    const isPlatformItem = showPlatforms && isSectionItem;
    const logoClass = "bp-rail__item-logo";

    return (
      <button
        key={item.key}
        ref={el => {
          itemRefs.current[index] = el;
        }}
        className={`bp-rail__item${isSectionItem ? " is-section-item" : ""}${isPlatformItem ? " is-platform" : ""}${focused ? " is-focused" : ""}`}
        tabIndex={expanded ? 0 : -1}
        onFocus={() => setCursor(index)}
        onMouseEnter={() => setCursor(index)}
        onClick={() => go(item)}
        aria-current={index === activeIndex ? "page" : undefined}
      >
        <span className="bp-rail__item-icon">
          {item.logoImage ? (
            <img
              className={logoClass}
              src={item.logoImage}
              alt=""
              aria-hidden="true"
              onError={event => { event.currentTarget.style.display = "none"; }}
            />
          ) : ItemIcon ? (
            <ItemIcon size={item.iconSize ?? RAIL_ICON_SIZE} />
          ) : null}
        </span>
        <span className="bp-rail__item-label">{item.label}</span>
      </button>
    );
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
        aria-label={label}
        aria-hidden={concealed && !expanded}
        style={{ visibility: concealed && !expanded ? "hidden" : "visible" }}
        onMouseEnter={expand}
        onMouseLeave={collapse}
        onKeyDown={onRailKeyDown}
      >
        {/* Medida invisible de la pill colapsada */}
        <div ref={collapsedMeasureRef} className="bp-rail__measure" aria-hidden="true">
          <span className="bp-rail__collapsed-icon">
            {collapsedItem.logoImage ? (
              <img
                src={collapsedItem.logoImage}
                alt=""
              />
            ) : CollapsedIcon ? (
              <CollapsedIcon size={24} />
            ) : null}
          </span>
          <span className="bp-rail__collapsed-label">{collapsedLabel}</span>
        </div>

        <div
          className={`bp-rail__box${expanded ? " is-expanded" : ""}${parked ? " is-parked" : ""}`}
          style={{
            width: expanded ? RAIL_W : contracted ? CONTRACTED_PILL_W : collapsedW || "auto",
            height: expanded ? railOpenHeight : 48,
          }}
        >
          {!expanded && (
            <>
              <span className={`bp-rail__back-arrow${contracted ? " is-contracted" : ""}`} aria-hidden="true">
                <svg width="13" height="30" viewBox="0 0 12 29" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9.5 1.5L2.5 14.5L9.5 27.5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <button
                className={`bp-rail__collapsed${contracted ? " is-contracted" : ""}`}
                onClick={expand}
                onFocus={expand}
                aria-label={`Abrir navegación, sección actual: ${collapsedLabel}`}
              >
              <span className="bp-rail__collapsed-icon">
                {collapsedItem.logoImage ? (
                  <img
                    src={collapsedItem.logoImage}
                    alt=""
                  />
                ) : CollapsedIcon ? (
              <CollapsedIcon size={26} />
                ) : null}
              </span>
              <span className={`bp-rail__collapsed-label${contracted ? " is-contracted" : ""}`}>{collapsedLabel}</span>
              </button>
            </>
          )}

          <div className={`bp-rail__expanded${expanded ? " is-visible" : ""}`} aria-hidden={!expanded}>
            {/* Perfil + reloj */}
            {showProfile && <button
              ref={profileButtonRef}
              type="button"
              className="bp-rail__profile"
              tabIndex={expanded ? 0 : -1}
              onFocus={() => setCursor("profile")}
              aria-label="Cambiar perfil"
              title="Cambiar perfil"
              onClick={() => {
                collapse();
                navigate("/profiles?from=big-picture");
              }}
            >
              <span className="bp-rail__avatar">
                {profile?.avatarDataUrl ? (
                  <img src={profile.avatarDataUrl} alt="" />
                ) : (
                  <span>{getProfileInitial(profile)}</span>
                )}
              </span>
              <span className="bp-rail__profile-name">{profile?.name?.trim() || "Perfil"}</span>
              <span className="bp-rail__clock">{clock}</span>
            </button>}
            <div ref={menuRef} className="bp-rail__menu">
              {/* Indicador blanco animado (pill de foco) */}
              <div
                className="bp-rail__indicator"
                style={{
                  top: getRailItemOffset(indicatorIndex ?? 0, sectionStartIndex),
                  height: indicatorIndex !== null && indicatorIndex >= sectionStartIndex ? PLATFORM_ITEM_H : RAIL_ITEM_H,
                  display: indicatorIndex === null ? "none" : undefined,
                }}
              />
              {visibleItems.map((item, index) => renderRailItem(item, index))}
              {sectionTitle && <><div className="bp-rail__section-title">{sectionTitle}</div>
              {sectionItems.map((item, index) =>
                renderRailItem(item, sectionStartIndex + index),
              )}</>}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
