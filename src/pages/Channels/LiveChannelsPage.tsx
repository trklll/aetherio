import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ListFilter, LoaderCircle, Play, RefreshCw, Search, X } from "lucide-react";
import clsx from "clsx";
import { BUNDLED_IPTV_CHANNELS, getAttachedPlaylistEpgUrls, loadConfiguredPlaylistChannels, resolveIptvChannelStream, type IptvChannel } from "../../services/iptvChannels";
import type { XmltvGuide } from "../../services/iptvSports";
import { loadAndVerifyIptvChannels, type ChannelVerificationProgress } from "../../services/iptvChannelCatalog";
import { primeLivePlaybackSession } from "../../services/liveSportsService";
import { buildPlayerPath } from "../../utils/bigPictureDetail";
import { openPictureRail } from "../../navigation/spatialNav";
import type { LiveChannelProgramme } from "../../types/liveSports";
import ChannelLivePreview from "./ChannelLivePreview";
import ChannelSearchDialog from "./ChannelSearchDialog";
import { buildProgrammeIndex, channelProgrammes, channelTime, cleanChannelName, filterLiveChannels, LIVE_FILTERS, programmeWindow, uniqueChannels, type LiveFilter } from "./liveChannelModel";
import "./ChannelsTV.css";
import "./LiveChannelsPage.css";

const PAGE_SIZE = 48;
const HALF_HOUR = 30 * 60_000;
const INITIAL_CHANNELS = uniqueChannels(BUNDLED_IPTV_CHANNELS);

function ChannelIdentity({ channel, compact = false }: { channel: IptvChannel; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={clsx("live-channel-identity", compact && "live-channel-identity--compact")}>
    {channel.logo && !failed && <img src={channel.logo} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    <span><strong>{cleanChannelName(channel.name)}</strong><small>{channel.country || channel.language || channel.sourceName}</small></span>
  </span>;
}

export default function LiveChannelsPage({ bigPicture = false }: { bigPicture?: boolean }) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLButtonElement>(null);
  const [channels, setChannels] = useState(INITIAL_CHANNELS);
  const [selectedId, setSelectedId] = useState(() => (INITIAL_CHANNELS.find(channel => /teledeporte/i.test(channel.name)) ?? INITIAL_CHANNELS[0])?.id ?? "");
  const [inspected, setInspected] = useState<LiveChannelProgramme | null>(null);
  const [filter, setFilter] = useState<LiveFilter>("all");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [guideLoading, setGuideLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verificationProgress, setVerificationProgress] = useState<ChannelVerificationProgress>({ completed: 0, total: 0, online: 0, offline: 0 });
  const [issues, setIssues] = useState<string[]>([]);
  const [guides, setGuides] = useState<XmltvGuide[]>([]);
  const [clock, setClock] = useState(Date.now);
  const [timeOffset, setTimeOffset] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [playError, setPlayError] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setGuideLoading(true);
    setVerifying(false);
    setVerificationProgress({ completed: 0, total: 0, online: 0, offline: 0 });
    setIssues([]);
    setGuides([]);
    void (async () => {
      let catalog = INITIAL_CHANNELS;
      let guideUrls = getAttachedPlaylistEpgUrls();
      try {
        const playlists = await loadConfiguredPlaylistChannels(revision > 0);
        catalog = uniqueChannels([...BUNDLED_IPTV_CHANNELS, ...playlists.channels]);
        guideUrls = [...new Set([...guideUrls, ...(playlists.epgUrls ?? [])])];
        if (active) {
          setChannels(catalog);
          setIssues(playlists.failedPlaylists);
        }
      } catch {
        if (active) {
          setChannels(catalog);
          setIssues(["Las listas externas"]);
        }
      } finally {
        if (active) setLoading(false);
      }

      if (!active) return;
      const result = await loadAndVerifyIptvChannels(catalog, guideUrls, {
        force: revision > 0,
        onGuideProgress: progress => {
          if (!active) return;
          setGuides(progress.guides);
          if (progress.completed === progress.total) {
            setGuideLoading(false);
            setVerifying(true);
          }
        },
        onVerificationProgress: progress => {
          if (!active) return;
          setVerificationProgress(progress);
          setVerifying(progress.completed < progress.total);
        },
      });
      if (!active) return;
      setGuides(result.guides);
      setChannels(result.channels);
      setSelectedId(current => result.channels.some(channel => channel.id === current) ? current : result.channels[0]?.id ?? "");
      setGuideLoading(false);
      setVerifying(false);
    })().catch(() => {
      if (!active) return;
      setGuideLoading(false);
      setVerifying(false);
      setLoading(false);
      setIssues(current => [...current, "No se pudo completar la verificación de señales"]);
    });
    return () => { active = false; };
  }, [revision]);

  const programmeIndex = useMemo(() => buildProgrammeIndex(guides), [guides]);
  const sources = useMemo(() => [...new Set(channels.map(channel => channel.sourceName))], [channels]);
  const filtered = useMemo(() => filterLiveChannels(channels, filter, query, source), [channels, filter, query, source]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selected = channels.find(channel => channel.id === selectedId) ?? channels[0];
  const selectedSchedule = selected ? channelProgrammes(selected, programmeIndex) : [];
  const currentProgramme = selectedSchedule.find(programme => Date.parse(programme.startsAt) <= clock && Date.parse(programme.endsAt) > clock);
  const programme = inspected ?? currentProgramme;
  const future = programme ? Date.parse(programme.startsAt) > clock : false;
  const start = Math.floor(clock / HALF_HOUR) * HALF_HOUR + timeOffset * HALF_HOUR;
  const end = start + 4 * HALF_HOUR;
  const ticks = Array.from({ length: 4 }, (_, index) => start + index * HALF_HOUR);
  const progress = currentProgramme ? Math.min(100, Math.max(0, (clock - Date.parse(currentProgramme.startsAt)) / (Date.parse(currentProgramme.endsAt) - Date.parse(currentProgramme.startsAt)) * 100)) : 0;

  useEffect(() => {
    if (!bigPicture) return;
    const frame = requestAnimationFrame(() => {
      const row = rootRef.current?.querySelector<HTMLElement>(`[data-live-channel="${CSS.escape(selectedId)}"] button`)
        ?? rootRef.current?.querySelector<HTMLElement>("[data-live-row] button");
      row?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
    // Entry focus only: network refresh must not steal controller focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bigPicture]);

  function selectChannel(channel: IptvChannel, nextProgramme?: LiveChannelProgramme) {
    setSelectedId(channel.id);
    setInspected(nextProgramme ?? null);
    setPlayError("");
  }

  function updateFilters(change: () => void) {
    change();
    setPage(1);
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  }

  async function playChannel(channel: IptvChannel) {
    if (launching) return;
    setLaunching(true);
    setPlayError("");
    try {
      const resolved = await resolveIptvChannelStream(channel);
      const id = `iptv-channel:${channel.id}`;
      primeLivePlaybackSession({ id, title: channel.name, sport: "otro", league: channel.group || channel.sourceName,
        status: "live", startsAt: new Date().toISOString(), logo: resolved.logo,
        sources: [{ id: `${id}:source`, label: channel.sourceName, url: resolved.streamUrl, quality: resolved.quality,
          language: resolved.language, providerId: channel.sourceId, origin: "iptv", channelName: channel.name }],
      });
      const search = new URLSearchParams({ type: "live", id, from: "channels" }).toString();
      navigate(bigPicture ? `/big-picture/player?${search}` : buildPlayerPath(search));
    } catch (error) {
      setPlayError(error instanceof Error ? error.message : "No se pudo abrir el canal. Prueba otra señal.");
    } finally { setLaunching(false); }
  }

  function reveal(element: HTMLElement) {
    if (!bigPicture || !scrollRef.current) return;
    const viewport = scrollRef.current.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const heading = rootRef.current?.querySelector(".live-guide__times")?.getBoundingClientRect().height ?? 36;
    if (rect.top < viewport.top + heading + 4) scrollRef.current.scrollTop += rect.top - viewport.top - heading - 4;
    else if (rect.bottom > viewport.bottom - 4) scrollRef.current.scrollTop += rect.bottom - viewport.bottom + 4;
    const channelWidth = rootRef.current?.querySelector(".live-guide__identity")?.getBoundingClientRect().width ?? 0;
    if (rect.left < viewport.left + channelWidth) scrollRef.current.scrollLeft += rect.left - viewport.left - channelWidth;
    else if (rect.right > viewport.right) scrollRef.current.scrollLeft += rect.right - viewport.right;
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!bigPicture || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (target.matches("input, select")) return;
    const row = target.closest<HTMLElement>("[data-live-row]");
    event.preventDefault();
    event.stopPropagation();
    if (row) {
      const rows = Array.from(rootRef.current!.querySelectorAll<HTMLElement>("[data-live-row]"));
      const rowIndex = rows.indexOf(row);
      const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>("button"));
      const buttonIndex = buttons.indexOf(target.closest("button")!);
      let next: HTMLElement | null | undefined;
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : rowIndex + (event.key === "ArrowDown" ? 1 : -1);
        const nextButtons = rows[nextIndex]?.querySelectorAll<HTMLButtonElement>("button");
        next = nextButtons?.[Math.min(Math.max(0, buttonIndex), nextButtons.length - 1)];
        if (!next && event.key === "ArrowUp") next = rootRef.current?.querySelector<HTMLElement>(".live-channels__filter--active");
        if (!next && event.key === "ArrowDown") next = rootRef.current?.querySelector<HTMLElement>(".live-guide__pagination button:not(:disabled)");
      } else {
        next = buttons[buttonIndex + (event.key === "ArrowRight" ? 1 : -1)];
        if (!next && event.key === "ArrowLeft") openPictureRail();
      }
      next?.focus({ preventScroll: true });
      return;
    }
    const group = target.closest<HTMLElement>("[data-live-controls]");
    if (event.key === "ArrowDown") {
      const next = group?.classList.contains("live-channels__header") ? rootRef.current?.querySelector<HTMLElement>(".live-channels__play")
        : group?.classList.contains("live-channels__actions") ? rootRef.current?.querySelector<HTMLElement>(".live-channels__filter--active")
        : rootRef.current?.querySelector<HTMLElement>("[data-live-row] button");
      next?.focus({ preventScroll: true });
    } else if (event.key === "ArrowUp") {
      rootRef.current?.querySelector<HTMLElement>(group?.classList.contains("live-channels__toolbar") ? ".live-channels__play" : ".live-channels__filter--active")?.focus({ preventScroll: true });
    } else {
      const controls = Array.from((group ?? rootRef.current!).querySelectorAll<HTMLElement>("button:not(:disabled)"));
      const index = controls.indexOf(target.closest("button")!);
      const next = controls[event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : index + (event.key === "ArrowRight" ? 1 : -1)];
      if (next) next.focus({ preventScroll: true });
      else if (event.key === "ArrowLeft") openPictureRail();
    }
  }

  return <main ref={rootRef} className={clsx("live-channels", bigPicture && "live-channels--tv")} aria-labelledby="live-channels-title"
    data-bp-channels={bigPicture ? "" : undefined} data-spatial-navigation={bigPicture ? "local" : undefined} onKeyDown={onKeyDown}>
    <header className="live-channels__header" data-live-controls>
      <h1 id="live-channels-title">Canales</h1>
      <div className="live-channels__utilities"><time dateTime={new Date(clock).toISOString()}>{new Date(clock).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}<b>{channelTime(clock)}</b></time>
        <button type="button" className="live-channels__refresh" aria-label="Actualizar canales y programación" title="Actualizar canales y programación" disabled={loading || guideLoading || verifying} onClick={() => setRevision(value => value + 1)}><RefreshCw size={18} className={loading || guideLoading || verifying ? "live-channels__spinner" : undefined} /></button>
      </div>
    </header>

    {selected && <section className="live-channels__featured" aria-labelledby="live-programme-title">
      <ChannelLivePreview channel={selected} />
      <div className="live-channels__details">
        <div className="live-channels__station"><span>{cleanChannelName(selected.name)}</span>{selected.quality && <small>{selected.quality}</small>}</div>
        <h2 id="live-programme-title">{programme?.title ?? cleanChannelName(selected.name)}</h2>
        <p className="live-channels__metadata">{programme ? `${channelTime(programme.startsAt)} – ${channelTime(programme.endsAt)}` : selected.group || "Televisión en directo"}{selected.country && <span>{selected.country}</span>}{selected.language && <span>{selected.language}</span>}</p>
        <p className="live-channels__description">{programme?.description || programme?.subtitle || (guideLoading ? "Consultando la programación de este canal." : "Esta fuente no incluye programación. Puedes ver su emisión en directo.")}</p>
        {currentProgramme && !future && <div className="live-channels__progress" aria-label={`${Math.round(progress)} % del programa emitido`}><span style={{ width: `${progress}%` }} /></div>}
        <div className="live-channels__actions" data-live-controls>
          <button type="button" className="live-channels__play" disabled={launching} onClick={() => void playChannel(selected)}>{launching ? <LoaderCircle size={18} className="live-channels__spinner" /> : <Play size={18} fill="currentColor" />}Ver canal</button>
          <span className="live-channels__source-label">{future ? "Más tarde · La vista previa sigue en directo" : selected.sourceName}</span>
        </div>
        {playError && <p className="live-channels__error" role="alert">{playError}</p>}
      </div>
    </section>}

    <div className="live-channels__toolbar" data-live-controls>
      <nav className="live-channels__filters" aria-label="Filtrar canales">
        {LIVE_FILTERS.map(item => <button key={item.id} type="button" className={clsx(filter === item.id && "live-channels__filter--active")} aria-pressed={filter === item.id} onClick={() => updateFilters(() => setFilter(item.id))}>{item.label}</button>)}
      </nav>
      <div className="live-channels__search-tools">
        <button type="button" className="live-channels__list-filter" aria-label={`Lista: ${source === "all" ? "Todas las listas" : source}. Cambiar lista`} title="Cambiar lista" onClick={() => updateFilters(() => setSource(["all", ...sources][(["all", ...sources].indexOf(source) + 1) % (sources.length + 1)]))}><ListFilter size={18} /><span>{source === "all" ? "Todas las listas" : source}</span></button>
        {bigPicture ? <button ref={searchRef} type="button" className="live-channels__search liquid-glass-pill" aria-label="Buscar canal" aria-haspopup="dialog" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}><Search size={18} /><span>{query || "Buscar canal"}</span></button>
          : <label className="live-channels__search liquid-glass-pill"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Buscar canal" placeholder="Buscar canal" value={query} onChange={event => updateFilters(() => setQuery(event.target.value))} /></label>}
        {query && <button type="button" className="live-channels__clear" aria-label="Borrar búsqueda" onClick={() => updateFilters(() => setQuery(""))}><X size={18} /></button>}
      </div>
    </div>

    <section className="live-guide" aria-labelledby="live-guide-title">
      <header className="live-guide__header" data-live-controls>
        <div><h2 id="live-guide-title">Guía de canales</h2><span>{filtered.length.toLocaleString("es-ES")} canales{loading ? " · Actualizando listas…" : ""}</span></div>
        <div className="live-guide__time-controls liquid-glass-pill"><button type="button" aria-label="Ver horario anterior" disabled={timeOffset === 0} onClick={() => setTimeOffset(value => Math.max(0, value - 2))}><ChevronLeft size={19} /></button><button type="button" onClick={() => { setTimeOffset(0); scrollRef.current?.scrollTo({ left: 0 }); }}>Ahora</button><button type="button" aria-label="Ver horario siguiente" disabled={timeOffset >= 44} onClick={() => setTimeOffset(value => Math.min(44, value + 2))}><ChevronRight size={19} /></button></div>
      </header>
      {visible.length ? <div className="live-guide__scroll" ref={scrollRef}>
        <div className="live-guide__canvas">
          <div className="live-guide__times" aria-hidden="true"><span>Canal</span><div>{ticks.map(time => <span key={time}>{channelTime(time)}</span>)}</div></div>
          {visible.map(channel => {
            const schedule = channelProgrammes(channel, programmeIndex);
            const entries = schedule.flatMap(entry => { const window = programmeWindow(entry, start, end); return window ? [{ entry, window }] : []; });
            const active = channel.id === selectedId;
            return <div key={channel.id} className={clsx("live-guide__row", active && "live-guide__row--selected")} data-live-row data-live-channel={channel.id}>
              <button type="button" className="live-guide__identity" aria-label={`Seleccionar ${cleanChannelName(channel.name)}`} aria-pressed={active} onFocus={bigPicture ? event => { selectChannel(channel); reveal(event.currentTarget); } : undefined} onClick={() => bigPicture ? void playChannel(channel) : selectChannel(channel)} onDoubleClick={!bigPicture ? () => void playChannel(channel) : undefined}><ChannelIdentity channel={channel} compact /></button>
              <div className="live-guide__schedule">
                {entries.length ? entries.map(({ entry, window }) => <button type="button" key={`${entry.startsAt}:${entry.title}`} className={clsx("live-guide__programme", Date.parse(entry.startsAt) <= clock && Date.parse(entry.endsAt) > clock && "live-guide__programme--now")}
                  style={{ "--programme-left": `${window.left}%`, "--programme-width": `${window.width}%` } as CSSProperties}
                  aria-label={`${channel.name}, ${entry.title}, ${channelTime(entry.startsAt)} a ${channelTime(entry.endsAt)}`}
                  onFocus={bigPicture ? event => { selectChannel(channel, entry); reveal(event.currentTarget); } : undefined} onClick={() => selectChannel(channel, entry)}>
                  <strong>{entry.title}</strong><span>{channelTime(entry.startsAt)} – {channelTime(entry.endsAt)}</span>
                </button>) : <button type="button" className="live-guide__no-epg" aria-label={`Vista previa de ${cleanChannelName(channel.name)}`} onFocus={bigPicture ? event => { selectChannel(channel); reveal(event.currentTarget); } : undefined} onClick={() => bigPicture ? void playChannel(channel) : selectChannel(channel)}><span>Emisión en directo</span><small>{guideLoading ? "Consultando horarios…" : "Programación no disponible"}</small><Play size={16} fill="currentColor" aria-hidden="true" /></button>}
              </div>
            </div>;
          })}
        </div>
      </div> : <div className="live-guide__empty" role="status"><h3>No encontramos ese canal</h3><p>Prueba otro nombre o restablece los filtros.</p><button type="button" onClick={() => updateFilters(() => { setFilter("all"); setQuery(""); setSource("all"); })}>Restablecer filtros</button></div>}
      <footer className="live-guide__footer" data-live-controls>
        <span aria-live="polite">{loading ? "Cargando listas…" : guideLoading ? "Descargando guías de programación…" : verifying
          ? `Verificando señales · ${verificationProgress.completed.toLocaleString("es-ES")} / ${verificationProgress.total.toLocaleString("es-ES")}`
          : verificationProgress.total > 0
            ? `${verificationProgress.online.toLocaleString("es-ES")} señales activas · ${verificationProgress.offline.toLocaleString("es-ES")} temporalmente ocultas`
            : "Horarios de las fuentes · La disponibilidad de cada señal puede variar"}</span>
        {issues.length > 0 && <span>{issues.length} {issues.length === 1 ? "lista no disponible" : "listas no disponibles"} · Los canales incluidos siguen accesibles</span>}
        {pages > 1 && <nav className="live-guide__pagination" aria-label="Páginas de canales"><button type="button" aria-label="Página anterior de canales" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); scrollRef.current?.scrollTo({ top: 0 }); }}><ChevronLeft size={18} /></button><span>{currentPage} / {pages}</span><button type="button" aria-label="Página siguiente de canales" disabled={currentPage === pages} onClick={() => { setPage(currentPage + 1); scrollRef.current?.scrollTo({ top: 0 }); }}><ChevronRight size={18} /></button></nav>}
      </footer>
    </section>
    {bigPicture && searchOpen && <ChannelSearchDialog value={query} onChange={value => updateFilters(() => setQuery(value))} count={filtered.length} triggerRef={searchRef} onClose={() => setSearchOpen(false)} />}
  </main>;
}
