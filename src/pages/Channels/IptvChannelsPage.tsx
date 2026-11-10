import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe2, LoaderCircle, Play, RadioTower, RefreshCw, Search, Tv, X } from "lucide-react";
import clsx from "clsx";
import type { LiveEvent, LiveSource } from "../../types/liveSports";
import { primeLivePlaybackSession } from "../../services/liveSportsService";
import {
  BUNDLED_IPTV_CHANNELS,
  IPTV_CAT_CHANNELS,
  IPTV_CAT_SNAPSHOT_AT,
  loadConfiguredPlaylistChannels,
  resolveIptvChannelStream,
  type IptvChannel,
} from "../../services/iptvChannels";
import { buildPlayerPath } from "../../utils/bigPictureDetail";
import "./IptvChannelsPage.css";

const PAGE_SIZE = 72;
const QUICK_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "sports", label: "Deportes" },
  { id: "spanish", label: "Español" },
  { id: "peru", label: "Perú" },
  { id: "latin-america", label: "Latinoamérica" },
] as const;

type QuickFilter = typeof QUICK_FILTERS[number]["id"];

function normalize(value: string | undefined) {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function matchesQuickFilter(channel: IptvChannel, filter: QuickFilter) {
  if (filter === "all") return true;
  if (filter === "peru") return channel.countryCode?.toUpperCase() === "PE" || channel.regions?.includes("peru") === true;
  if (filter === "latin-america") return channel.regions?.includes("latin-america") === true;
  if (filter === "spanish") {
    return channel.sourceId === "iptv-free-spanish"
      || /\b(spanish|espanol|español|castellano)\b|^(es|spa)$/i.test(channel.language ?? "")
      || /\b(spanish|espanol|español|castellano)\b/i.test(`${channel.name} ${channel.group ?? ""}`);
  }
  return /sport|deport|futbol|fútbol|soccer|espn/i.test(`${channel.sourceId} ${channel.sourceName} ${channel.group ?? ""} ${channel.name}`);
}

function channelLogo(channel: IptvChannel) {
  if (channel.logo) return channel.logo;
  if (channel.countryCode) return `https://iptvcat.net/assets/images/flags/${channel.countryCode.toLowerCase()}.png`;
  return "";
}

export default function IptvChannelsPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState(BUNDLED_IPTV_CHANNELS);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loadingPlaylists, setLoadingPlaylists] = useState(true);
  const [failedPlaylists, setFailedPlaylists] = useState<string[]>([]);
  const [launchingId, setLaunchingId] = useState("");
  const [error, setError] = useState("");

  async function loadPlaylists(force = false) {
    setLoadingPlaylists(true);
    setFailedPlaylists([]);
    try {
      const result = await loadConfiguredPlaylistChannels(force);
      setChannels([...BUNDLED_IPTV_CHANNELS, ...result.channels]);
      setFailedPlaylists(result.failedPlaylists);
    } catch {
      setFailedPlaylists(["Las listas externas"]);
    } finally {
      setLoadingPlaylists(false);
    }
  }

  useEffect(() => {
    let active = true;
    void loadConfiguredPlaylistChannels().then(result => {
      if (!active) return;
      setChannels([...BUNDLED_IPTV_CHANNELS, ...result.channels]);
      setFailedPlaylists(result.failedPlaylists);
      setLoadingPlaylists(false);
    }).catch(() => {
      if (!active) return;
      setFailedPlaylists(["Las listas externas"]);
      setLoadingPlaylists(false);
    });
    return () => { active = false; };
  }, []);

  const sources = useMemo(() => [...new Set(channels.map(channel => channel.sourceName))].sort((a, b) => a.localeCompare(b, "es")), [channels]);
  const filteredChannels = useMemo(() => {
    const search = normalize(query);
    return channels.filter(channel => (
      (quickFilter === "all" || matchesQuickFilter(channel, quickFilter))
      && (sourceFilter === "all" || channel.sourceName === sourceFilter)
      && (!search || normalize(`${channel.name} ${channel.group ?? ""} ${channel.country ?? ""} ${channel.sourceName}`).includes(search))
    ));
  }, [channels, quickFilter, query, sourceFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredChannels.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleChannels = filteredChannels.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function updateQuickFilter(next: QuickFilter) {
    setQuickFilter(next);
    setPage(1);
  }

  function updateSourceFilter(next: string) {
    setSourceFilter(next);
    setPage(1);
  }

  function updateQuery(next: string) {
    setQuery(next);
    setPage(1);
  }

  async function playChannel(channel: IptvChannel) {
    setLaunchingId(channel.id);
    setError("");
    try {
      const resolved = await resolveIptvChannelStream(channel);
      const id = `iptv-channel:${channel.id}`;
      const source: LiveSource = {
        id: `${id}:source`,
        label: channel.sourceName,
        url: resolved.streamUrl,
        quality: resolved.quality,
        language: resolved.language,
        providerId: channel.sourceId,
        origin: "iptv",
        channelName: channel.name,
        verifiedAt: Date.now(),
      };
      const event: LiveEvent = {
        id,
        title: channel.name,
        sport: "otro",
        league: channel.group || channel.sourceName,
        status: "live",
        startsAt: new Date().toISOString(),
        logo: resolved.logo,
        sources: [source],
      };
      primeLivePlaybackSession(event);
      const search = new URLSearchParams({ type: "live", id, from: "channels" }).toString();
      navigate(buildPlayerPath(search));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo abrir este canal.");
    } finally {
      setLaunchingId("");
    }
  }

  return (
    <main className="channels-page iptv-channels" aria-labelledby="iptv-channels-heading">
      <header className="iptv-channels__header">
        <div>
          <p className="iptv-channels__eyebrow"><RadioTower size={14} aria-hidden="true" /> TELEVISIÓN EN DIRECTO</p>
          <h1 id="iptv-channels-heading">Canales</h1>
          <p className="iptv-channels__intro">Tus listas IPTV reunidas en un solo lugar. Busca un canal y pulsa reproducir.</p>
        </div>
        <div className="iptv-channels__summary" aria-live="polite">
          <strong>{filteredChannels.length.toLocaleString("es-ES")}</strong>
          <span>{filteredChannels.length === 1 ? "canal" : "canales"}</span>
          {loadingPlaylists && <span className="iptv-channels__loading"><LoaderCircle size={14} /> Cargando listas…</span>}
          {!loadingPlaylists && <button type="button" onClick={() => void loadPlaylists(true)} aria-label="Actualizar listas IPTV"><RefreshCw size={15} /> Actualizar</button>}
        </div>
      </header>

      <div className="iptv-channels__provenance">
        <span><Tv size={15} aria-hidden="true" /> {IPTV_CAT_CHANNELS.length.toLocaleString("es-ES")} señales de IPTV Cat marcadas online el {new Date(IPTV_CAT_SNAPSHOT_AT).toLocaleDateString("es-ES")}</span>
        <span><Globe2 size={15} aria-hidden="true" /> Adjunto + 4 listas M3U</span>
      </div>

      <section className="iptv-channels__toolbar" aria-label="Buscar y filtrar canales">
        <label className="iptv-channels__search liquid-glass-pill">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={query} onChange={event => updateQuery(event.target.value)} placeholder="Buscar canal, país o categoría" aria-label="Buscar canal, país o categoría" />
          {query && <button type="button" onClick={() => updateQuery("")} aria-label="Borrar búsqueda"><X size={15} /></button>}
        </label>
        <label className="iptv-channels__source">
          <span>Lista</span>
          <select value={sourceFilter} onChange={event => updateSourceFilter(event.target.value)} aria-label="Filtrar por lista">
            <option value="all">Todas las listas</option>
            {sources.map(source => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
      </section>

      <nav className="iptv-channels__filters" aria-label="Filtros rápidos">
        {QUICK_FILTERS.map(filter => (
          <button key={filter.id} type="button" aria-pressed={quickFilter === filter.id}
            className={clsx(quickFilter === filter.id && "iptv-channels__filter--active")}
            onClick={() => updateQuickFilter(filter.id)}>{filter.label}</button>
        ))}
      </nav>

      {failedPlaylists.length > 0 && <p className="iptv-channels__warning" role="status">
        No se pudieron cargar: {failedPlaylists.join(", ")}. Las listas incluidas en la app siguen disponibles.
      </p>}
      {error && <p className="iptv-channels__error" role="alert">{error}</p>}

      {visibleChannels.length > 0 ? (
        <>
          <section className="iptv-channels__grid" aria-label="Canales IPTV" aria-busy={Boolean(launchingId)}>
            {visibleChannels.map(channel => {
              const logo = channelLogo(channel);
              return (
                <article className="iptv-channel" key={channel.id}>
                  <div className="iptv-channel__logo" aria-hidden="true">
                    {logo ? <img src={logo} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true; }} /> : <Tv size={23} />}
                  </div>
                  <div className="iptv-channel__details">
                    <p className="iptv-channel__source">{channel.sourceName}{channel.country ? ` · ${channel.country}` : ""}</p>
                    <h2 title={channel.name}>{channel.name}</h2>
                    <p className="iptv-channel__meta">{channel.group || "Televisión"}{channel.language ? ` · ${channel.language}` : ""}</p>
                  </div>
                  <button type="button" className="iptv-channel__play" onClick={() => void playChannel(channel)}
                    disabled={Boolean(launchingId)} aria-label={`Reproducir ${channel.name}`} title={`Reproducir ${channel.name}`}>
                    {launchingId === channel.id ? <LoaderCircle size={17} className="iptv-channels__spinner" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}
                  </button>
                </article>
              );
            })}
          </section>
          {pageCount > 1 && <nav className="iptv-channels__pagination" aria-label="Páginas de canales">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
            <span>Página {currentPage} de {pageCount}</span>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Siguiente</button>
          </nav>}
        </>
      ) : (
        <div className="iptv-channels__empty" role="status">
          <Tv size={24} aria-hidden="true" />
          <h2>No hay canales con esos filtros</h2>
          <p>Prueba otra búsqueda o selecciona una categoría distinta.</p>
          <button type="button" onClick={() => { updateQuery(""); updateQuickFilter("all"); updateSourceFilter("all"); }}>Limpiar filtros</button>
        </div>
      )}

      <footer className="iptv-channels__footer">
        {BUNDLED_IPTV_CHANNELS.length.toLocaleString("es-ES")} canales integrados en la app
        {loadingPlaylists ? " · Consultando las listas externas…" : ` · ${channels.length.toLocaleString("es-ES")} señales cargadas`}
      </footer>
    </main>
  );
}
