import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
  LogIn,
  LogOut,
  Palette,
  PlayCircle,
  Puzzle,
  RadioTower,
  RotateCcw,
  UserRound,
} from "lucide-react";
import { TogglePill } from "../../components/ui/ToggleSwitch";
import packageJson from "../../../package.json";
import aetherioLogo from "../../assets/aetheriologo.png";
import { getApiKeys, saveApiKeys, type ApiKeys } from "../../config/apiKeys.ts";
import {
  applyHomeCatalogPreferences,
  catalogPreferenceKey,
  mergedCatalogOrder,
  saveHomePreferences,
  sortHomeCatalogRows,
  useHomePreferences,
  type BothContentPreference,
  type ContentOrientation,
  type HomePreferences,
} from "../../config/homePreferences.ts";
import {
  saveSpatialPosterSettings,
  useSpatialPosterSettings,
  type SpatialPosterSettings,
} from "../../config/spatialPosters.ts";
import {
  MDBLIST_PROVIDER_OPTIONS,
  saveMdbListSettings,
  useMdbListSettings,
} from "../../config/mdblist.ts";
import {
  DEFAULT_PLAYBACK_PREFERENCES,
  LANGUAGE_OPTIONS,
  savePlaybackPreferences,
  usePlaybackPreferences,
  type PlaybackPreferences,
} from "../../config/playbackPreferences.ts";
import { useHomeCatalogs } from "../../hooks/useCatalogs.ts";
import { useAddonStore } from "../../store/addonStore.ts";
import {
  ensureLocalNuvioSportsServer,
  readNuvioSportsMode,
  writeNuvioSportsMode,
  type NuvioSportsMode,
} from "../../services/nuvioSportsRuntime.ts";
import { probeStremioSportsProvider } from "../../services/stremioSportsProviders.ts";
import {
  AETHERIO_AUTH_CHANGED_EVENT,
  connectAniListAccount,
  getStoredAccount,
  leaveLocalMode,
  logoutAccount,
  requestOAuthLinkIntent,
  startSocialLogin,
} from "../../auth/authClient.ts";
import {
  getActiveProfile,
  getLocalProfiles,
  LOCAL_PROFILES_CHANGED_EVENT,
  setActiveProfile,
  type LocalProfile,
} from "../../utils/localProfiles.ts";

type SettingsSection = "account" | "design" | "playback" | "sources" | "addons" | "about";

const SECTIONS: readonly { id: SettingsSection; label: string; description: string; icon: typeof UserRound }[] = [
  { id: "account", label: "Cuenta", description: "Perfil y sesión", icon: UserRound },
  { id: "design", label: "Diseño", description: "Inicio y pósters", icon: Palette },
  { id: "playback", label: "Reproducción", description: "Audio, vídeo y episodios", icon: PlayCircle },
  { id: "sources", label: "Fuentes", description: "Servicios conectados", icon: RadioTower },
  { id: "addons", label: "Complementos", description: "Catálogos y streams", icon: Puzzle },
  { id: "about", label: "Acerca de", description: "Versión y ayuda", icon: Info },
];

const SECTION_IDS = new Set<SettingsSection>(SECTIONS.map(section => section.id));

function initialSection(search: string): SettingsSection {
  const value = new URLSearchParams(search).get("tab");
  return value && SECTION_IDS.has(value as SettingsSection) ? value as SettingsSection : "account";
}

export default function BigPictureSettings() {
  const location = useLocation();
  const navigate = useNavigate();
  const [section, setSection] = useState<SettingsSection>(() => initialSection(location.search));
  const [notice, setNotice] = useState("");
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setSection(initialSection(location.search));
  }, [location.search]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Foco inicial con mando. La page es lazy: cuando spatialNav agenda su
  // focusInitialContent (380 ms) el chunk puede seguir cargando y el rail
  // queda excluido de los candidatos, así que a 380 ms todavía no hay nada
  // que enfocar. Igual que Genre/Party/Search, la page marca su primer
  // control y se enfoca a sí misma al montar.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      primaryRef.current?.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(timer);
  }, []);

  const selectSection = (next: SettingsSection) => {
    setSection(next);
    setNotice("");
    navigate(`/big-picture/settings?tab=${next}`, { replace: true });
  };

  const saved = (message = "Guardado") => setNotice(message);

  return (
    <main className="bp-settings-page" data-bp-settings>
      <header className="bp-settings-page__header">
        <h1>Ajustes</h1>
      </header>

      <div className="bp-settings-page__layout">
        <nav className="bp-settings-page__nav" aria-label="Categorías de ajustes">
          {SECTIONS.map((item, index) => {
            const Icon = item.icon;
            const selected = item.id === section;
            return (
              <button
                key={item.id}
                ref={index === 0 ? primaryRef : undefined}
                type="button"
                data-bp-settings-primary={index === 0 ? "" : undefined}
                className={`bp-settings-page__nav-item liquid-glass${selected ? " is-selected" : ""}`}
                aria-current={selected ? "page" : undefined}
                onClick={() => selectSection(item.id)}
              >
                <span className="bp-settings-page__nav-icon"><Icon size={25} /></span>
                <span className="bp-settings-page__nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <ChevronRight size={22} className="bp-settings-page__nav-chevron" />
              </button>
            );
          })}
        </nav>

        <section className="bp-settings-page__content" aria-live="polite">
          {section === "account" ? <AccountSection onNavigate={path => navigate(path)} onNotice={saved} /> : null}
          {section === "design" ? <DesignSection onNotice={saved} /> : null}
          {section === "playback" ? <PlaybackSection onNotice={saved} /> : null}
          {section === "sources" ? <SourcesSection onNavigate={path => navigate(path)} onNotice={saved} /> : null}
          {section === "addons" ? <AddonsSection onNavigate={path => navigate(path)} /> : null}
          {section === "about" ? <AboutSection /> : null}
        </section>
      </div>

      {notice ? <div className="bp-settings-page__notice" role="status"><Check size={18} />{notice}</div> : null}
    </main>
  );
}

function AccountSection({ onNavigate, onNotice }: { onNavigate: (path: string) => void; onNotice: (message?: string) => void }) {
  const [account, setAccount] = useState(() => getStoredAccount());
  const [activeProfile, setActiveProfileState] = useState<LocalProfile | null>(() => getActiveProfile());
  const [profiles, setProfiles] = useState<LocalProfile[]>(() => getLocalProfiles());

  async function connectProvider(provider: "google" | "anilist") {
    try {
      if (provider === "anilist") {
        await connectAniListAccount();
      } else if (account) {
        const linkToken = await requestOAuthLinkIntent(provider);
        await startSocialLogin(provider, linkToken);
      } else {
        await startSocialLogin(provider);
      }
      onNotice("Autoriza la conexión en el navegador. Volverás automáticamente a Aetherio.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "No se pudo iniciar la conexión.");
    }
  }

  useEffect(() => {
    const refresh = () => {
      setAccount(getStoredAccount());
      setActiveProfileState(getActiveProfile());
      setProfiles(getLocalProfiles());
    };
    window.addEventListener(AETHERIO_AUTH_CHANGED_EVENT, refresh);
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AETHERIO_AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function switchProfile(profile: LocalProfile) {
    if (profile.id === activeProfile?.id) return;
    if (profile.pin) {
      onNotice("Este perfil tiene PIN. Cámbialo desde la pantalla de perfiles.");
      return;
    }
    setActiveProfile(profile.id);
    window.location.reload();
  }

  return (
    <SettingsPanel title="Cuenta" description="Tu sesión y el perfil que usa Aetherio en este dispositivo.">
      <SettingsGroup title="Sesión">
        <SettingsInfoRow
          title={account?.displayName ?? "Modo local"}
          description={account?.email ?? "Tus perfiles se guardan solo en este dispositivo."}
          leading={<span className="bp-settings-page__avatar">{(account?.displayName ?? activeProfile?.name ?? "A").slice(0, 1).toUpperCase()}</span>}
        >
          {account ? (
            <SettingsAction icon={<LogOut size={19} />} onClick={() => void logoutAccount()}>Cerrar sesión</SettingsAction>
          ) : (
            <SettingsAction icon={<LogIn size={19} />} onClick={() => void connectProvider("google")}>Conectar</SettingsAction>
          )}
        </SettingsInfoRow>
      </SettingsGroup>

      <SettingsGroup title="Cuentas vinculadas">
        <SettingsActionRow title="Google" description="Vincula Google para acceder con tu cuenta Aetherio." onClick={() => void connectProvider("google")} />
        <SettingsActionRow title="AniList" description="Conecta AniList para sincronizar tu biblioteca de anime." onClick={() => void connectProvider("anilist")} />
        {!account ? <SettingsActionRow title="Crear cuenta" description="Crea una cuenta Aetherio para sincronizar tus datos." onClick={() => { leaveLocalMode(); onNavigate("/?auth=register"); }} /> : null}
      </SettingsGroup>

      <SettingsGroup title="Perfil activo">
        <SettingsInfoRow
          title={activeProfile?.name ?? "Sin perfil seleccionado"}
          description={activeProfile?.pin ? "Protegido con PIN" : "Este perfil controla tus preferencias y progreso."}
          leading={<span className="bp-settings-page__avatar bp-settings-page__avatar--small">{(activeProfile?.name ?? "A").slice(0, 1).toUpperCase()}</span>}
        />
        {profiles.length > 1 ? profiles.map(profile => (
          <button
            key={profile.id}
            type="button"
            className={`bp-settings-page__profile-row${profile.id === activeProfile?.id ? " is-active" : ""}`}
            onClick={() => switchProfile(profile)}
            aria-pressed={profile.id === activeProfile?.id}
          >
            <span className="bp-settings-page__profile-dot">{profile.name.slice(0, 1).toUpperCase()}</span>
            <span>{profile.name}</span>
            <span className="bp-settings-page__profile-state">{profile.id === activeProfile?.id ? "Activo" : profile.pin ? "Tiene PIN" : "Entrar"}</span>
          </button>
        )) : null}
        <SettingsActionRow title="Cambiar perfil" description="Selecciona otro perfil local o crea uno nuevo." onClick={() => onNavigate("/profiles?from=big-picture")} />
      </SettingsGroup>

    </SettingsPanel>
  );
}

function DesignSection({ onNotice }: { onNotice: (message?: string) => void }) {
  const preferences = useHomePreferences();
  const spatialPosters = useSpatialPosterSettings();
  const addons = useAddonStore(state => state.addons);
  const { rows, loading } = useHomeCatalogs(addons);

  function updateHome(patch: Partial<HomePreferences>) {
    saveHomePreferences({ ...preferences, ...patch });
    onNotice();
  }

  function updatePosters(patch: Partial<SpatialPosterSettings>) {
    saveSpatialPosterSettings({ ...spatialPosters, ...patch });
    onNotice();
  }

  const orderedRows = useMemo(() => sortHomeCatalogRows(rows, preferences), [rows, preferences]);
  const visibleRows = useMemo(() => applyHomeCatalogPreferences(rows, preferences), [rows, preferences]);

  function moveCatalog(row: typeof rows[number], direction: "up" | "down") {
    const order = mergedCatalogOrder(rows, preferences.catalogOrder);
    const key = catalogPreferenceKey(row);
    const index = order.indexOf(key);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    updateHome({ catalogOrder: next });
  }

  function toggleCatalog(row: typeof rows[number]) {
    const key = catalogPreferenceKey(row);
    const hidden = new Set(preferences.hiddenCatalogKeys);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    updateHome({ hiddenCatalogKeys: [...hidden] });
  }

  return (
    <SettingsPanel title="Diseño" description="Decide qué aparece primero y qué información acompaña a tus títulos.">
      <SettingsGroup title="Pantalla de inicio">
        <ChoiceRow
          title="Contenido principal"
          description="Ordena el inicio por películas y series, anime o ambos."
          value={preferences.contentOrientation}
          options={[
            { value: "movies-series", label: "Películas y series" },
            { value: "anime", label: "Anime" },
            { value: "both", label: "Ambos" },
          ]}
          onChange={value => updateHome({ contentOrientation: value as ContentOrientation })}
        />
        {preferences.contentOrientation === "both" ? (
          <ChoiceRow
            title="Preferencia cuando muestras ambos"
            value={preferences.bothPreference}
            options={[{ value: "movies-series", label: "Películas primero" }, { value: "anime", label: "Anime primero" }]}
            onChange={value => updateHome({ bothPreference: value as BothContentPreference })}
          />
        ) : null}
        <ToggleRow title="Completar arte con TMDB" description="Usa TMDB como respaldo cuando el addon no trae imagen." value={preferences.allowTmdbArtworkFallback} onChange={value => updateHome({ allowTmdbArtworkFallback: value })} />
        <ToggleRow title="Reproducir intros de plataformas" description="Muestra la intro al entrar a una página de plataforma." value={preferences.playStreamingPlatformIntros} onChange={value => updateHome({ playStreamingPlatformIntros: value })} />
      </SettingsGroup>

      <SettingsGroup title="SpatialPosters">
        <ToggleRow title="Usar SpatialPosters" description="Pósters con etiquetas de género, ranking y distribuidora." value={spatialPosters.enabled} onChange={value => updatePosters({ enabled: value })} />
      </SettingsGroup>

      <SettingsGroup title="Catálogos">
        {loading ? <SettingsHint>Cargando catálogos...</SettingsHint> : null}
        {!loading && orderedRows.length === 0 ? <SettingsHint>No hay catálogos disponibles.</SettingsHint> : null}
        {orderedRows.map((row, index) => {
          const hidden = preferences.hiddenCatalogKeys.includes(catalogPreferenceKey(row));
          return (
            <div key={catalogPreferenceKey(row)} className={`bp-settings-page__catalog-row${hidden ? " is-hidden" : ""}`}>
              <button type="button" className="bp-settings-page__catalog-main" onClick={() => toggleCatalog(row)} aria-pressed={!hidden}>
                <span><strong>{cleanCatalogTitle(row.name)}</strong><small>{row.items.length} títulos{hidden ? " · Oculto" : ""}</small></span>
                <span className={`bp-settings-page__status-dot${hidden ? " is-off" : ""}`} />
              </button>
              <div className="bp-settings-page__catalog-arrows">
                <SmallAction label="Subir" disabled={index === 0} onClick={() => moveCatalog(row, "up")}><ChevronUp size={18} /></SmallAction>
                <SmallAction label="Bajar" disabled={index === orderedRows.length - 1} onClick={() => moveCatalog(row, "down")}><ChevronDown size={18} /></SmallAction>
              </div>
            </div>
          );
        })}
        <SettingsHint>{visibleRows.length} catálogos activos.</SettingsHint>
      </SettingsGroup>
    </SettingsPanel>
  );
}

function PlaybackSection({ onNotice }: { onNotice: (message?: string) => void }) {
  const preferences = usePlaybackPreferences();

  function update(patch: Partial<PlaybackPreferences>) {
    savePlaybackPreferences({ ...preferences, ...patch });
    onNotice();
  }

  return (
    <SettingsPanel title="Reproducción" description="Ajusta cómo empiezan, suenan y terminan tus vídeos.">
      <SettingsGroup title="Reproductor">
        <ToggleRow title="Mostrar superposición de carga" description="Indica cuándo el stream todavía está empezando." value={preferences.showLoadingOverlay} onChange={value => update({ showLoadingOverlay: value })} />
        <ToggleRow title="Mantener Espacio para acelerar" description="Mantén la tecla para reproducir más rápido en escritorio." value={preferences.holdToAccelerate} onChange={value => update({ holdToAccelerate: value })} />
        <CycleRow title="Velocidad al mantener" value={`${preferences.holdToAccelerateSpeed}x`} options={["1.25x", "1.5x", "2x", "2.5x", "3x"]} onChange={value => update({ holdToAccelerateSpeed: Number.parseFloat(value) })} />
        <ToggleRow title="Reutilizar último enlace" description="Prueba el último stream que funcionó para este título." value={preferences.reuseLastLink} onChange={value => update({ reuseLastLink: value })} />
        <CycleRow title="Modo de selección de stream" value={preferences.sourceSelectionMode === "first" ? "Primera fuente" : "Manual"} options={["Manual", "Primera fuente"]} onChange={value => update({ sourceSelectionMode: value === "Primera fuente" ? "first" : "manual" })} />
        <ToggleRow title="Probar otra fuente automáticamente" description="Tras un fallo, prueba hasta dos fuentes alternativas. Puede que ninguna funcione; esta opción solo cambia los reintentos automáticos." value={preferences.automaticSourceRecovery} onChange={value => update({ automaticSourceRecovery: value })} />
      </SettingsGroup>

      <SettingsGroup title="Audio y subtítulos">
        <CycleRow title="Idioma de audio preferido" value={languageLabel(preferences.firstAudioLanguage)} selectedValue={preferences.firstAudioLanguage} options={LANGUAGE_OPTIONS.map(option => option.value)} onChange={value => update({ firstAudioLanguage: value })} />
        <CycleRow title="Idioma de audio secundario" value={languageLabel(preferences.secondAudioLanguage)} selectedValue={preferences.secondAudioLanguage} options={LANGUAGE_OPTIONS.map(option => option.value)} onChange={value => update({ secondAudioLanguage: value })} />
        <CycleRow title="Idioma de subtítulos preferido" value={languageLabel(preferences.preferredSubtitleLanguage)} selectedValue={preferences.preferredSubtitleLanguage} options={LANGUAGE_OPTIONS.map(option => option.value)} onChange={value => update({ preferredSubtitleLanguage: value })} />
          <CycleRow title="Idioma de subtítulos secundario" value={languageLabel(preferences.secondSubtitleLanguage)} selectedValue={preferences.secondSubtitleLanguage} options={LANGUAGE_OPTIONS.map(option => option.value)} onChange={value => update({ secondSubtitleLanguage: value })} />
          <ChoiceRow
            title="Sincronización automática de subtítulos"
            description="Ajusta solo los subtítulos mal sincronizados comparándolos con otras traducciones del mismo título."
            value={preferences.autoSubtitleSync}
            options={[
              { value: "on", label: "Siempre" },
              { value: "learned", label: "Aprendido" },
              { value: "off", label: "Nunca" },
            ]}
            onChange={value => update({ autoSubtitleSync: value as PlaybackPreferences["autoSubtitleSync"] })}
          />
        <CycleRow title="Carga de subtítulos del addon" value={preferences.addonSubtitleLoadMode === "all" ? "Todos" : "Preferido"} options={["Preferido", "Todos"]} onChange={value => update({ addonSubtitleLoadMode: value === "Todos" ? "all" : "preferred" })} />
      </SettingsGroup>

      <SettingsGroup title="Siguiente episodio">
        <ToggleRow title="Reproducción automática" description="Empieza el siguiente episodio al llegar al final." value={preferences.autoPlayNextEpisode} onChange={value => update({ autoPlayNextEpisode: value })} />
        <ToggleRow title="Preferir grupo binge" value={preferences.preferBingeGroup} onChange={value => update({ preferBingeGroup: value })} />
        <CycleRow title="Modo de umbral" value={preferences.nextEpisodeThresholdMode === "minutes" ? "Minutos" : "Porcentaje"} options={["Porcentaje", "Minutos"]} onChange={value => update({ nextEpisodeThresholdMode: value === "Minutos" ? "minutes" : "percentage" })} />
        {preferences.nextEpisodeThresholdMode === "minutes" ? (
          <CycleRow title="Minutos antes del final" value={`${preferences.nextEpisodeThresholdMinutesBeforeEnd} min`} options={["0 min", "0.5 min", "1 min", "1.5 min", "2 min", "2.5 min", "3 min", "3.5 min"]} onChange={value => update({ nextEpisodeThresholdMinutesBeforeEnd: Number.parseFloat(value) })} />
        ) : (
          <CycleRow title="Porcentaje de umbral" value={`${preferences.nextEpisodeThresholdPercent}%`} options={["97%", "98%", "99%", "100%"]} onChange={value => update({ nextEpisodeThresholdPercent: Number.parseInt(value, 10) })} />
        )}
      </SettingsGroup>

      <SettingsGroup title="Siguiente contenido">
        <ToggleRow title="Recomendación al terminar" description="Muestra una recomendación cuando acaba una película o temporada." value={preferences.upNextEnabled} onChange={value => update({ upNextEnabled: value })} />
        <CycleRow title="Umbral de película" value={`${preferences.postPlayMovieThresholdPercent}%`} options={["80%", "85%", "90%", "95%", "100%"]} onChange={value => update({ postPlayMovieThresholdPercent: Number.parseInt(value, 10) })} />
      </SettingsGroup>

      <SettingsGroup title="Segmentos y presencia">
        <ToggleRow title="Saltar intro, outro y resumen" value={preferences.skipSegmentsEnabled} onChange={value => update({ skipSegmentsEnabled: value })} />
        <ToggleRow title="Anime Skip" description="Usa marcas de salto de Anime Skip si has configurado un Client ID." value={preferences.animeSkipEnabled} onChange={value => update({ animeSkipEnabled: value })} />
        <ToggleRow title="Discord Rich Presence" description="Muestra localmente qué estás viendo en Discord." value={preferences.enableDiscordRichPresence} onChange={value => update({ enableDiscordRichPresence: value })} />
        <CycleRow title="Decodificación por hardware" value={hardwareLabel(preferences.hardwareDecoding)} options={["Auto", "Activada", "Desactivada"]} onChange={value => update({ hardwareDecoding: value === "Activada" ? "enabled" : value === "Desactivada" ? "disabled" : "auto" })} />
        <ToggleRow title="Passthrough de audio avanzado" description="Solo para receptores compatibles con AC3, DTS o Atmos." value={preferences.audioPassthrough} onChange={value => update({ audioPassthrough: value })} />
      </SettingsGroup>

      <SettingsAction icon={<RotateCcw size={19} />} onClick={() => { savePlaybackPreferences(DEFAULT_PLAYBACK_PREFERENCES); onNotice("Valores restaurados"); }}>Restaurar valores de reproducción</SettingsAction>
    </SettingsPanel>
  );
}

function SourcesSection({ onNavigate, onNotice }: { onNavigate: (path: string) => void; onNotice: (message?: string) => void }) {
  const addons = useAddonStore(state => state.addons);
  const mdbList = useMdbListSettings();
  const [keys, setKeys] = useState<ApiKeys>(() => getApiKeys());
  const [nuvioMode, setNuvioMode] = useState<NuvioSportsMode>(() => readNuvioSportsMode());
  const [checkingNuvio, setCheckingNuvio] = useState(false);
  const [editing, setEditing] = useState<{ title: string; value: string; save: (value: string) => void } | null>(null);
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setEditing(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editing]);

  function updateMdb(patch: Partial<typeof mdbList>) {
    saveMdbListSettings({ ...mdbList, ...patch });
    onNotice();
  }

  function saveCredential(key: keyof Pick<ApiKeys, "animeSkipClientId" | "introDbApiKey">, value: string) {
    const next = { ...keys, [key]: value };
    saveApiKeys(next);
    setKeys(next);
    onNotice();
  }

  async function checkNuvio() {
    setCheckingNuvio(true);
    try {
      await ensureLocalNuvioSportsServer();
      const result = await probeStremioSportsProvider("nuvio");
      onNotice(result.ok
        ? `Sports${result.version ? ` ${result.version}` : ""} responde correctamente.`
        : result.error ?? "Sports no respondió.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "No se pudo comprobar Sports.");
    } finally {
      setCheckingNuvio(false);
    }
  }

  return (
    <SettingsPanel title="Fuentes" description="Los servicios conectados a Aetherio aparecen aquí y en sus pantallas dedicadas.">
      <SettingsGroup title="Estado">
        <SettingsInfoRow title="Catálogos instalados" description={`${addons.length} complementos disponibles para buscar y reproducir.`} />
        <SettingsInfoRow title="TMDB" description="Se usa el proxy de Aetherio cuando no tienes una clave propia." />
        <SettingsInfoRow title="AniList" description="La cuenta de anime se gestiona desde Cuenta en la app normal." />
      </SettingsGroup>
      <SettingsGroup title="Sports">
        <ChoiceRow
          title="Instancia deportiva"
          description="Sports se ejecuta dentro de Aetherio; no tienes que abrir otra app. También puedes elegir la instancia remota."
          value={nuvioMode}
          options={[{ value: "local", label: "Local" }, { value: "remote", label: "Remota" }]}
          onChange={value => {
            const mode = value as NuvioSportsMode;
            writeNuvioSportsMode(mode);
            setNuvioMode(mode);
            onNotice("Preferencia de Sports guardada.");
          }}
        />
        <SettingsHint>La instancia local escucha solo en este equipo. El addon todavía puede contactar proveedores o Workers de terceros para descubrir y resolver streams.</SettingsHint>
        <SettingsActionRow
          title={checkingNuvio ? "Comprobando Sports…" : "Comprobar conexión"}
          description={nuvioMode === "local" ? "Inicia la instancia local si aún no está activa." : "Verifica la instancia remota configurada."}
          onClick={() => void checkNuvio()}
        />
      </SettingsGroup>
      <SettingsGroup title="Ratings MDBList">
        <ToggleRow title="Activar MDBList Ratings" description="Obtiene puntuaciones externas para la pantalla de detalle." value={mdbList.enabled} onChange={value => updateMdb({ enabled: value })} />
        {MDBLIST_PROVIDER_OPTIONS.map(option => (
          <ToggleRow key={option.provider} title={option.label} description={option.description} value={mdbList[option.settingKey]} onChange={value => updateMdb({ [option.settingKey]: value })} />
        ))}
        <CredentialRow title="API key de MDBList" configured={Boolean(mdbList.apiKey)} onClick={() => setEditing({ title: "API key de MDBList", value: mdbList.apiKey, save: value => updateMdb({ apiKey: value }) })} />
      </SettingsGroup>
      <SettingsGroup title="Credenciales de servicios">
        <CredentialRow title="Anime Skip Client ID" configured={Boolean(keys.animeSkipClientId)} onClick={() => setEditing({ title: "Anime Skip Client ID", value: keys.animeSkipClientId, save: value => saveCredential("animeSkipClientId", value) })} />
        <CredentialRow title="Token de TheIntroDB" configured={Boolean(keys.introDbApiKey)} onClick={() => setEditing({ title: "Token de TheIntroDB", value: keys.introDbApiKey, save: value => saveCredential("introDbApiKey", value) })} />
        <SettingsHint>Las claves se guardan en el perfil local activo y se muestran siempre ocultas.</SettingsHint>
      </SettingsGroup>
      <SettingsGroup title="Acciones">
        <SettingsActionRow title="Gestionar complementos" description="Activa, desactiva o instala fuentes de contenido." onClick={() => onNavigate("/big-picture/addons")} />
        <SettingsHint>Las autorizaciones OAuth se abren en el navegador; las credenciales de servicios se editan con el teclado en pantalla.</SettingsHint>
      </SettingsGroup>
      {editing ? <CredentialEditor title={editing.title} value={editing.value} onCancel={() => setEditing(null)} onSave={value => { editing.save(value); setEditing(null); }} /> : null}
    </SettingsPanel>
  );
}

function AddonsSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const addons = useAddonStore(state => state.addons);
  const enabled = addons.filter(addon => addon.enabled).length;
  return (
    <SettingsPanel title="Complementos" description="Extiende los catálogos, metadatos y streams disponibles en Aetherio.">
      <SettingsGroup title="Resumen">
        <SettingsInfoRow title={`${enabled} activos de ${addons.length}`} description="El estado se aplica inmediatamente al volver al inicio." />
        <SettingsActionRow title="Abrir gestor de complementos" description="Ver fuentes, activar o desactivar addons e instalar uno nuevo." onClick={() => onNavigate("/big-picture/addons")} />
      </SettingsGroup>
    </SettingsPanel>
  );
}

function AboutSection() {
  return (
    <SettingsPanel title="Acerca de" description="Información de esta instalación de Aetherio.">
      <SettingsGroup title="Aetherio">
        <SettingsInfoRow title="Aetherio" description={`Versión ${packageJson.version ?? "desconocida"}`} leading={<img className="bp-settings-page__brand-logo" src={aetherioLogo} alt="" />} />
        <SettingsInfoRow title="Modo Big Picture" description="Interfaz inmersiva optimizada para mando, navegación espacial y pantalla grande." />
      </SettingsGroup>
    </SettingsPanel>
  );
}

function SettingsPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="bp-settings-page__panel">
      <header className="bp-settings-page__panel-header">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div className="bp-settings-page__groups">{children}</div>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bp-settings-page__group">
      <h3>{title}</h3>
      <div className="bp-settings-page__group-body liquid-glass">{children}</div>
    </section>
  );
}

function SettingsInfoRow({ title, description, leading, children }: { title: string; description?: string; leading?: ReactNode; children?: ReactNode }) {
  return (
    <div className="bp-settings-page__info-row">
      {leading}
      <div className="bp-settings-page__row-copy"><strong>{title}</strong>{description ? <span>{description}</span> : null}</div>
      {children ? <div className="bp-settings-page__row-action">{children}</div> : null}
    </div>
  );
}

function SettingsActionRow({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" className="bp-settings-page__action-row liquid-glass" onClick={onClick}>
      <span><strong>{title}</strong><small>{description}</small></span>
      <ChevronRight size={24} />
    </button>
  );
}

function CredentialRow({ title, configured, onClick }: { title: string; configured: boolean; onClick: () => void }) {
  return (
    <button type="button" className="bp-settings-page__action-row liquid-glass" onClick={onClick}>
      <span><strong>{title}</strong><small>{configured ? "Configurada" : "No configurada"}</small></span>
      <ChevronRight size={24} />
    </button>
  );
}

function SettingsAction({ children, icon, onClick, disabled }: { children: ReactNode; icon?: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="bp-settings-page__action" onClick={onClick} disabled={disabled}>{icon}{children}</button>;
}

function SettingsHint({ children }: { children: ReactNode }) {
  return <p className="bp-settings-page__hint-block">{children}</p>;
}

function ToggleRow({ title, description, value, onChange }: { title: string; description?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" className={`bp-settings-page__toggle-row${value ? " is-on" : ""}`} onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <span className="bp-settings-page__row-copy"><strong>{title}</strong>{description ? <small>{description}</small> : null}</span>
      <TogglePill checked={value} />
    </button>
  );
}

function ChoiceRow({ title, description, value, options, onChange }: { title: string; description?: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="bp-settings-page__choice-row">
      <div className="bp-settings-page__row-copy"><strong>{title}</strong>{description ? <small>{description}</small> : null}</div>
      <div className="bp-settings-page__choices">
        {options.map(option => <button key={option.value} type="button" className={value === option.value ? "is-selected" : ""} onClick={() => onChange(option.value)} aria-pressed={value === option.value}>{option.label}</button>)}
      </div>
    </div>
  );
}

function CycleRow({ title, value, selectedValue = value, options, onChange }: { title: string; value: string; selectedValue?: string; options: string[]; onChange: (value: string) => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const currentIndex = Math.max(0, options.indexOf(selectedValue));

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const onCycle = (event: Event) => {
      const direction = (event as CustomEvent<{ direction?: "left" | "right" }>).detail?.direction;
      const delta = direction === "left" ? -1 : 1;
      onChange(options[(currentIndex + delta + options.length) % options.length] ?? selectedValue);
    };
    button.addEventListener("aetherio-spatial-cycle", onCycle);
    return () => button.removeEventListener("aetherio-spatial-cycle", onCycle);
  }, [currentIndex, onChange, options, selectedValue]);

  const next = options[(currentIndex + 1) % options.length] ?? selectedValue;
  return (
    <button ref={buttonRef} type="button" className="bp-settings-page__cycle-row" data-spatial-cycle onClick={() => onChange(next)}>
      <span className="bp-settings-page__row-copy"><strong>{title}</strong></span>
      <span className="bp-settings-page__cycle-value">{value}<ChevronRight size={21} /></span>
    </button>
  );
}

function SmallAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="bp-settings-page__small-action" aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function labelFor(options: readonly { value: string; label: string }[], value: string) {
  return options.find(option => option.value === value)?.label ?? value;
}

function languageLabel(value: string) {
  return labelFor(LANGUAGE_OPTIONS, value);
}

function hardwareLabel(value: PlaybackPreferences["hardwareDecoding"]) {
  return value === "enabled" ? "Activada" : value === "disabled" ? "Desactivada" : "Auto";
}

function cleanCatalogTitle(name: string) {
  return name
    .replace(/\s*\|.+$/, "")
    .replace(/\s*\.\s*.+$/, "")
    .replace(/\s*(ElfHosted|AIOMetadata|Cinemeta)\s*$/i, "")
    .trim() || name.trim();
}

const CREDENTIAL_KEYS = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."0123456789",
  ":", "/", ".", "-", "_", "@",
];

function CredentialEditor({ title, value, onCancel, onSave }: { title: string; value: string; onCancel: () => void; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [uppercase, setUppercase] = useState(false);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="bp-settings-page__modal" data-spatial-modal role="dialog" aria-label={`Editar ${title}`}>
      <div className="bp-settings-page__editor">
        <div className="bp-settings-page__editor-head"><span>{title}</span><strong>{draft ? "•".repeat(Math.min(draft.length, 34)) : "Sin valor"}</strong></div>
        <div className="bp-settings-page__editor-keys">
          {CREDENTIAL_KEYS.map((key, index) => (
            <button key={key} ref={index === 0 ? firstRef : undefined} type="button" onClick={() => setDraft(current => current + (uppercase ? key.toUpperCase() : key))}>{uppercase ? key.toUpperCase() : key}</button>
          ))}
          <button type="button" onClick={() => setUppercase(current => !current)}>{uppercase ? "Aa" : "aa"}</button>
          <button type="button" onClick={() => setDraft(current => current.slice(0, -1))}>Borrar</button>
          <button type="button" onClick={() => setDraft("")}>Limpiar</button>
          <button type="button" className="is-save" onClick={() => onSave(draft)}><Check size={20} />Guardar</button>
        </div>
        <button type="button" className="bp-settings-page__editor-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
