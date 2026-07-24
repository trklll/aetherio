import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  ImagePlus,
  Info,
  LogIn,
  Palette,
  PlayCircle,
  Plus,
  Puzzle,
  RadioTower,
  RefreshCw,
  Save,
  Trash2,
  Unlink,
  UserRound,
} from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import ProfileAvatar from "../../components/profile/ProfileAvatar";
import SourcesPanel from "./SourcesPanel";
import aetherioLogo from "../../assets/aetheriologo.png";
import { getApiKeys, saveApiKeys, type ApiKeys } from "../../config/apiKeys";
import {
  MDBLIST_PROVIDER_OPTIONS,
  getMdbListSettings,
  saveMdbListSettings,
  type MdbListSettings,
} from "../../config/mdblist";
import {
  applyHomeCatalogPreferences,
  catalogPreferenceKey,
  mergedCatalogOrder,
  saveHomePreferences,
  sortHomeCatalogRows,
  useHomePreferences,
  type ContentOrientation,
  type HomePreferences,
} from "../../config/homePreferences";
import {
  LANGUAGE_OPTIONS,
  getPlaybackPreferences,
  savePlaybackPreferences,
  type PlaybackPreferences,
} from "../../config/playbackPreferences";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData } from "../../types/ui";
import {
  createLocalProfile,
  deleteLocalProfile,
  getActiveProfile,
  getLocalProfiles,
  LOCAL_PROFILES_CHANGED_EVENT,
  readImageFileAsDataUrl,
  setActiveProfile,
  updateLocalProfile,
  verifyPin,
  type LocalProfile,
} from "../../utils/localProfiles";
import {
  disconnectTrakt,
  getTraktAuthSnapshot,
  startTraktAuthorization,
  syncTraktNow,
  TRAKT_AUTH_CHANGED_EVENT,
  type TraktAuthEventDetail,
} from "../../trakt";

type SettingsTab = "account" | "design" | "addons" | "sources" | "playback" | "about";
type AccountView = "overview" | "profiles" | "manage-profiles" | "create-profiles" | "integrations" | "tmdb" | "introdb" | "anime-skip" | "trakt" | "mdblist";
type DesignView = "overview" | "home-screen" | "detail-screen";

const SIDEBAR_ITEMS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "account", label: "Cuenta", icon: <UserRound size={17} /> },
  { id: "design", label: "Diseño", icon: <Palette size={17} /> },
  { id: "addons", label: "Complementos", icon: <Puzzle size={17} /> },
  { id: "sources", label: "Fuentes", icon: <RadioTower size={17} /> },
  { id: "playback", label: "Reproduccion", icon: <PlayCircle size={17} /> },
  { id: "about", label: "Acerca de", icon: <Info size={17} /> },
];

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const addons = useAddonStore(state => state.addons);
  const { rows: catalogRows, loading: catalogLoading } = useHomeCatalogs(addons);
  const homePreferences = useHomePreferences();
  const [localHomePreferences, setLocalHomePreferences] = useState<HomePreferences>(homePreferences);
  const [keys, setKeys] = useState<ApiKeys>(() => getApiKeys());
  const [mdbList, setMdbList] = useState<MdbListSettings>(() => getMdbListSettings());
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => getPlaybackPreferences());
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => getInitialTab(location.search));
  const [accountView, setAccountView] = useState<AccountView>(() => getInitialAccountView(location.search));
  const [designView, setDesignView] = useState<DesignView>("overview");
  const [saved, setSaved] = useState(false);
  const [profiles, setProfiles] = useState<LocalProfile[]>(() => getLocalProfiles());
  const [activeProfile, setActiveProfileState] = useState<LocalProfile | null>(() => getActiveProfile());
  const [profileName, setProfileName] = useState(() => getActiveProfile()?.name ?? "");
  const [profilePin, setProfilePin] = useState(() => getActiveProfile()?.pin ?? "");
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>(() => getActiveProfile()?.avatarDataUrl);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfilePin, setNewProfilePin] = useState("");
  const [newProfileAvatar, setNewProfileAvatar] = useState<string | undefined>();
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    setKeys(getApiKeys());
    setMdbList(getMdbListSettings());
    setPlayback(getPlaybackPreferences());
  }, []);

  useEffect(() => {
    setLocalHomePreferences(homePreferences);
  }, [homePreferences]);

  useEffect(() => {
    const tab = getInitialTab(location.search);
    setActiveTab(tab);
    setAccountView(getInitialAccountView(location.search));
  }, [location.search]);

  useEffect(() => {
    const refresh = () => {
      const nextActive = getActiveProfile();
      setProfiles(getLocalProfiles());
      setActiveProfileState(nextActive);
      setProfileName(nextActive?.name ?? "");
      setProfilePin(nextActive?.pin ?? "");
      setProfileAvatar(nextActive?.avatarDataUrl);
    };
    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const orderedCatalogRows = useMemo(
    () => sortHomeCatalogRows(catalogRows, localHomePreferences),
    [catalogRows, localHomePreferences],
  );
  const visibleCatalogRows = useMemo(
    () => applyHomeCatalogPreferences(catalogRows, localHomePreferences),
    [catalogRows, localHomePreferences],
  );

  function selectTab(tab: SettingsTab) {
    setSaved(false);
    setActiveTab(tab);
    setAccountView("overview");
    setDesignView("overview");
    navigate(`/settings?tab=${tab}`, { replace: true });
  }

  function updateKey(name: keyof ApiKeys, value: string) {
    setSaved(false);
    setKeys(current => ({ ...current, [name]: value }));
  }

  function saveIntegrations() {
    saveApiKeys(keys);
    setSaved(true);
  }

  function updatePlayback<Value extends PlaybackPreferences[keyof PlaybackPreferences]>(name: keyof PlaybackPreferences, value: Value) {
    setSaved(true);
    setPlayback(current => {
      const next = { ...current, [name]: value };
      savePlaybackPreferences(next);
      return next;
    });
  }

  function updateMdbList(patch: Partial<MdbListSettings>) {
    setSaved(true);
    setMdbList(current => {
      const next = { ...current, ...patch };
      saveMdbListSettings(next);
      return next;
    });
  }

  function updateHomePreferences(patch: Partial<HomePreferences>) {
    const next = { ...localHomePreferences, ...patch };
    setSaved(true);
    setLocalHomePreferences(next);
    saveHomePreferences(next);
  }

  function moveCatalog(row: CatalogRowData, direction: "left" | "right") {
    const order = mergedCatalogOrder(catalogRows, localHomePreferences.catalogOrder);
    const key = catalogPreferenceKey(row);
    const index = order.indexOf(key);
    const target = direction === "left" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    updateHomePreferences({ catalogOrder: next });
  }

  function toggleCatalog(row: CatalogRowData) {
    const key = catalogPreferenceKey(row);
    const hidden = new Set(localHomePreferences.hiddenCatalogKeys);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    updateHomePreferences({ hiddenCatalogKeys: Array.from(hidden) });
  }

  async function chooseProfileImage(event: ChangeEvent<HTMLInputElement>, target: "active" | "new") {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      if (target === "active") setProfileAvatar(dataUrl);
      else setNewProfileAvatar(dataUrl);
      setProfileError("");
      setSaved(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "No se pudo leer la imagen.");
    }
  }

  async function saveProfile() {
    if (!activeProfile) return;
    if (!profileName.trim()) {
      setProfileError("El perfil necesita un nombre.");
      return;
    }
    const updated = await updateLocalProfile(activeProfile.id, {
      name: profileName,
      pin: profilePin,
      avatarDataUrl: profileAvatar,
    });
    setProfileError("");
    setSaved(true);
    if (updated) setActiveProfileState(updated);
    setProfiles(getLocalProfiles());
  }

  async function createProfile() {
    if (!newProfileName.trim()) {
      setProfileError("Escribe un nombre para crear la cuenta.");
      return;
    }
    await createLocalProfile(
      { name: newProfileName, pin: newProfilePin, avatarDataUrl: newProfileAvatar },
      { makeActive: true }
    );
    window.location.reload();
  }

  async function switchProfile(profile: LocalProfile) {
    if (profile.id === activeProfile?.id) return;
    if (profile.pin) {
      const enteredPin = window.prompt("PIN del perfil");
      const { verifyPin } = await import("../../utils/localProfiles");
      if (!enteredPin || !(await verifyPin(enteredPin, profile.pin))) {
        setProfileError("PIN incorrecto.");
        return;
      }
    }
    setActiveProfile(profile.id);
    window.location.reload();
  }

  function deleteProfile(profile: LocalProfile) {
    deleteLocalProfile(profile.id);
    const remaining = getLocalProfiles();
    if (profile.id === activeProfile?.id) {
      if (remaining.length > 0) {
        setActiveProfile(remaining[0].id);
      }
      setActiveProfileState(getActiveProfile());
      setProfileName(remaining[0]?.name ?? "");
      setProfilePin(remaining[0]?.pin ?? "");
      setProfileAvatar(remaining[0]?.avatarDataUrl);
      setSaved(false);
      setProfileError("");
    }
    setProfiles(remaining);
  }

  return (
    <PageContainer className="min-h-screen py-5 lg:py-8">
      <div className="mx-auto grid max-w-[1360px] grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
        <aside className="self-start lg:sticky lg:top-4">
          <div className="mb-5 flex items-center gap-3 px-2">
            <img src={aetherioLogo} alt="Aetherio" className="h-12 w-12 rounded-2xl object-contain" />
            <div>
              <p className="text-xs font-black text-white/38">Aetherio</p>
              <h1 className="text-2xl font-black text-white">Ajustes</h1>
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-white/[0.055] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.34)] sm:grid-cols-3 lg:block lg:rounded-[30px]">
            {SIDEBAR_ITEMS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={clsx(
                  "flex w-full min-w-0 items-center gap-3 rounded-full px-4 py-3 text-left text-sm font-black gsap-transition lg:mb-1 lg:last:mb-0",
                  activeTab === item.id
                    ? "bg-white text-black"
                    : "text-white/62 hover:bg-white/10 hover:text-white",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 pb-16">
          {activeTab === "account" ? (
            <AccountPanel
              view={accountView}
              profiles={profiles}
              activeProfile={activeProfile}
              profileName={profileName}
              profilePin={profilePin}
              profileAvatar={profileAvatar}
              newProfileName={newProfileName}
              newProfilePin={newProfilePin}
              newProfileAvatar={newProfileAvatar}
              profileError={profileError}
              saved={saved}
              keys={keys}
              mdbList={mdbList}
              onViewChange={setAccountView}
              onProfileNameChange={value => {
                setSaved(false);
                setProfileName(value);
              }}
              onProfilePinChange={value => {
                setSaved(false);
                setProfilePin(value.replace(/\D/g, "").slice(0, 8));
              }}
              onNewProfileNameChange={setNewProfileName}
              onNewProfilePinChange={value => setNewProfilePin(value.replace(/\D/g, "").slice(0, 8))}
              onChooseProfileImage={event => chooseProfileImage(event, "active")}
              onChooseNewProfileImage={event => chooseProfileImage(event, "new")}
              onSaveProfile={saveProfile}
              onCreateProfile={createProfile}
              onStartProfileQuickStart={() => navigate("/quick-start/profile")}
              onSwitchProfile={switchProfile}
              onDeleteProfile={deleteProfile}
              onKeyChange={updateKey}
              onNavigateToProfiles={() => navigate("/profiles")}
              onMdbListChange={updateMdbList}
              onSaveIntegrations={saveIntegrations}
            />
          ) : null}

          {activeTab === "design" ? (
            <DesignPanel
              view={designView}
              preferences={localHomePreferences}
              catalogRows={orderedCatalogRows}
              visibleCatalogRows={visibleCatalogRows}
              catalogLoading={catalogLoading}
              onViewChange={setDesignView}
              onPreferencesChange={updateHomePreferences}
              onToggleCatalog={toggleCatalog}
              onMoveCatalog={moveCatalog}
            />
          ) : null}

          {activeTab === "addons" ? (
            <AddonsPanel
              installedCount={addons.length}
              enabledCount={addons.filter(addon => addon.enabled).length}
              onOpenAddons={() => navigate("/addons")}
            />
          ) : null}

          {activeTab === "sources" ? <SourcesPanel /> : null}

          {activeTab === "playback" ? (
            <PlaybackPanel playback={playback} onPlaybackChange={updatePlayback} saved={saved} />
          ) : null}

          {activeTab === "about" ? <AboutPanel /> : null}
        </main>
      </div>
    </PageContainer>
  );
}

function AccountPanel({
  view,
  profiles,
  activeProfile,
  profileName,
  profilePin,
  profileAvatar,
  newProfileName,
  newProfilePin,
  newProfileAvatar,
  profileError,
  saved,
  keys,
  mdbList,
  onViewChange,
  onProfileNameChange,
  onProfilePinChange,
  onNewProfileNameChange,
  onNewProfilePinChange,
  onChooseProfileImage,
  onChooseNewProfileImage,
  onSaveProfile,
  onCreateProfile,
  onStartProfileQuickStart,
  onSwitchProfile,
  onDeleteProfile,
  onKeyChange,
  onMdbListChange,
  onSaveIntegrations,
  onNavigateToProfiles,
}: {
  view: AccountView;
  profiles: LocalProfile[];
  activeProfile: LocalProfile | null;
  profileName: string;
  profilePin: string;
  profileAvatar?: string;
  newProfileName: string;
  newProfilePin: string;
  newProfileAvatar?: string;
  profileError: string;
  saved: boolean;
  keys: ApiKeys;
  mdbList: MdbListSettings;
  onViewChange: (view: AccountView) => void;
  onProfileNameChange: (value: string) => void;
  onProfilePinChange: (value: string) => void;
  onNewProfileNameChange: (value: string) => void;
  onNewProfilePinChange: (value: string) => void;
  onChooseProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onChooseNewProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onSaveProfile: () => void;
  onCreateProfile: () => void;
  onStartProfileQuickStart: () => void;
  onSwitchProfile: (profile: LocalProfile) => void;
  onDeleteProfile: (profile: LocalProfile) => void;
  onKeyChange: (name: keyof ApiKeys, value: string) => void;
  onNavigateToProfiles: () => void;
  onMdbListChange: (patch: Partial<MdbListSettings>) => void;
  onSaveIntegrations: () => void;
}) {
  const [traktAuth, setTraktAuth] = useState(() => getTraktAuthSnapshot());
  const [traktStatus, setTraktStatus] = useState("");
  const [traktError, setTraktError] = useState("");
  const [traktBusy, setTraktBusy] = useState(false);

  useEffect(() => {
    const refresh = (event: Event) => {
      setTraktAuth(getTraktAuthSnapshot());
      const detail = (event as CustomEvent<TraktAuthEventDetail | undefined>).detail;
      if (detail?.kind === "connected") {
        setTraktBusy(false);
        setTraktError("");
        setTraktStatus(detail.username ? `Conectado como ${detail.username}.` : "Trakt conectado.");
      } else if (detail?.kind === "disconnected") {
        setTraktBusy(false);
        setTraktStatus("Trakt desconectado. El progreso local se conserva.");
      } else if (detail?.kind === "error") {
        setTraktBusy(false);
        setTraktError(detail.message);
      }
    };
    window.addEventListener(TRAKT_AUTH_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(TRAKT_AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  async function startTraktConnection() {
    setTraktBusy(true);
    setTraktError("");
    setTraktStatus("");
    try {
      await startTraktAuthorization();
      setTraktAuth(getTraktAuthSnapshot());
      setTraktStatus("Autoriza Aetherio en Trakt. Volveras automaticamente a la app.");
      setTraktBusy(false);
    } catch (error) {
      setTraktError(describeUnknownError(error, "No se pudo iniciar la conexion con Trakt."));
      setTraktBusy(false);
    }
  }

  async function disconnectTraktAccount() {
    setTraktBusy(true);
    setTraktError("");
    try {
      await disconnectTrakt();
      setTraktAuth(getTraktAuthSnapshot());
      setTraktStatus("Trakt desconectado. El progreso local se conserva.");
    } catch (error) {
      setTraktError(describeUnknownError(error, "No se pudo desconectar Trakt."));
    } finally {
      setTraktBusy(false);
    }
  }

  async function runManualTraktSync() {
    setTraktBusy(true);
    setTraktError("");
    try {
      const result = await syncTraktNow();
      setTraktStatus(`Sincronizacion lista. Importados: ${result.imported}. Cola pendiente: ${result.queued}.`);
    } catch (error) {
      setTraktError(describeUnknownError(error, "No se pudo sincronizar Trakt."));
    } finally {
      setTraktBusy(false);
    }
  }

  if (view === "profiles") {
    return (
      <PanelScaffold title="Perfiles" onBack={() => onViewChange("overview")}>
        <PillBlock>
          <NavRow title="Administrar Perfiles" description="Cambiar nombre, PIN, avatar y perfil activo." onClick={() => onViewChange("manage-profiles")} />
          <NavRow title="Crear perfiles" description="Agregar otro perfil local con el Quick Start." onClick={onStartProfileQuickStart} />
          <NavRow title="Cambiar perfil" description="Volver a la pantalla de selección de perfiles." onClick={onNavigateToProfiles} />
        </PillBlock>
      </PanelScaffold>
    );
  }

  if (view === "manage-profiles") {
    return (
      <PanelScaffold title="Administrar Perfiles" onBack={() => onViewChange("profiles")}>
        <ManageProfiles
          profiles={profiles}
          activeProfile={activeProfile}
          profileName={profileName}
          profilePin={profilePin}
          profileAvatar={profileAvatar}
          saved={saved}
          profileError={profileError}
          onProfileNameChange={onProfileNameChange}
          onProfilePinChange={onProfilePinChange}
          onChooseProfileImage={onChooseProfileImage}
          onSaveProfile={onSaveProfile}
          onSwitchProfile={onSwitchProfile}
          onDeleteProfile={onDeleteProfile}
        />
      </PanelScaffold>
    );
  }

  if (view === "create-profiles") {
    return (
      <PanelScaffold title="Crear perfiles" onBack={() => onViewChange("profiles")}>
        <CreateProfile
          newProfileName={newProfileName}
          newProfilePin={newProfilePin}
          newProfileAvatar={newProfileAvatar}
          profileError={profileError}
          onNewProfileNameChange={onNewProfileNameChange}
          onNewProfilePinChange={onNewProfilePinChange}
          onChooseNewProfileImage={onChooseNewProfileImage}
          onCreateProfile={onCreateProfile}
        />
      </PanelScaffold>
    );
  }

  if (view === "integrations") {
    return (
      <PanelScaffold title="Integraciones" onBack={() => onViewChange("overview")}>
        <PillBlock>
          <NavRow title="MDBList" description="Configura ratings externos para la pantalla de detalle." onClick={() => onViewChange("mdblist")} />
          <NavRow title="IntroDB" description="Busca segmentos de intro y resumen para mostrar botones de salto cuando existan." onClick={() => onViewChange("introdb")} />
          <NavRow title="Anime skip" description="Usa Anime Skip para detectar intros en anime cuando tengas un Client ID." onClick={() => onViewChange("anime-skip")} />
          <NavRow title="Trakt.tv" description="Sincroniza progreso, historial visto y scrobbling con Trakt por perfil local." onClick={() => onViewChange("trakt")} />
        </PillBlock>
      </PanelScaffold>
    );
  }

  if (view === "trakt") {
    return (
      <PanelScaffold title="Trakt.tv" onBack={() => onViewChange("integrations")}>
        <div className="grid gap-5">
          <PillBlock>
            <PillRow
              title={traktAuth.connected ? `Conectado${traktAuth.username ? ` como ${traktAuth.username}` : ""}` : "Cuenta Trakt"}
              description={
                traktAuth.connected
                  ? "Scrobbling y sincronizacion activos para este perfil."
                  : traktAuth.authorizationPending
                    ? "Termina la autorizacion en Trakt o vuelve a abrir la pagina de conexion."
                    : "Conecta tu cuenta Trakt para sincronizar progreso, historial y scrobbling."
              }
            >
              {traktAuth.connected ? (
                <ActionButton onClick={disconnectTraktAccount} icon={<Unlink size={15} />} disabled={traktBusy}>Desconectar</ActionButton>
              ) : (
                <ActionButton onClick={startTraktConnection} icon={<LogIn size={15} />} disabled={traktBusy}>
                  {traktAuth.authorizationPending ? "Reabrir Trakt" : "Conectar Trakt.tv"}
                </ActionButton>
              )}
            </PillRow>
          </PillBlock>

          <div className="flex flex-wrap items-center gap-3">
            <ActionButton onClick={runManualTraktSync} icon={<RefreshCw size={15} />} disabled={traktBusy || !traktAuth.connected}>Sincronizar ahora</ActionButton>
          </div>
          {traktStatus ? <p className="text-sm text-white/56">{traktStatus}</p> : null}
          {traktError ? <p className="text-sm font-semibold text-red-300">{traktError}</p> : null}
        </div>
      </PanelScaffold>
    );
  }

  if (view === "mdblist") {
    return (
      <MdbListPanel
        settings={mdbList}
        saved={saved}
        onBack={() => onViewChange("integrations")}
        onChange={onMdbListChange}
      />
    );
  }

  if (view === "introdb" || view === "anime-skip") {
    const details = {
      introdb: {
        title: "IntroDB",
        description: "IntroDB permite resolver segmentos de intro y resumen cuando hay coincidencias por episodio.",
        key: "introDbApiKey" as const,
        label: "IntroDB API Key",
        docsUrl: "https://www.introdb.app/",
        docsLabel: "Sitio oficial",
        placeholder: "Opcional para enviar timestamps; la lectura no requiere clave",
      },
      "anime-skip": {
        title: "Anime skip",
        description: "Anime Skip puede detectar intros en anime usando el Client ID del servicio.",
        key: "animeSkipClientId" as const,
        label: "Anime-Skip Client ID",
        docsUrl: "https://anime-skip.com/",
        docsLabel: "Obtener Client ID",
        placeholder: "X-Client-ID de anime-skip.com",
      },
    }[view];

    return (
      <PanelScaffold title={details.title} onBack={() => onViewChange("integrations")}>
        <PillBlock>
          <PillRow
            title={details.label}
            titleAction={(
              <a href={details.docsUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-white/62 underline underline-offset-2 gsap-transition hover:text-white">
                {details.docsLabel}
              </a>
            )}
            description={details.description}
          >
            <input
              type="password"
              value={keys[details.key]}
              onChange={event => onKeyChange(details.key, event.target.value)}
              placeholder={details.placeholder}
              className="w-full rounded-full border border-white/18 bg-white px-4 py-2.5 text-sm text-black outline-none gsap-transition placeholder:text-black/45 focus:border-white/34"
            />
          </PillRow>
        </PillBlock>
        <div className="mt-5 flex items-center gap-3">
          <ActionButton onClick={onSaveIntegrations} icon={<Save size={15} />}>Guardar integracion</ActionButton>
          {saved ? <span className="text-sm text-white/54">Guardado.</span> : null}
        </div>
      </PanelScaffold>
    );
  }

  return (
    <PanelScaffold title="Cuenta">
      <PillBlock>
        <NavRow title="Perfiles" description="Administrar perfiles locales o crear nuevos." onClick={() => onViewChange("profiles")} />
        <NavRow title="Integraciones" description="Configurar TMDB, MDBList, IntroDB, Anime Skip y Trakt." onClick={() => onViewChange("integrations")} />
      </PillBlock>
    </PanelScaffold>
  );
}

function MdbListPanel({
  settings,
  saved,
  onBack,
  onChange,
}: {
  settings: MdbListSettings;
  saved: boolean;
  onBack: () => void;
  onChange: (patch: Partial<MdbListSettings>) => void;
}) {
  return (
    <PanelScaffold title="MDBList" onBack={onBack}>
      <div className="grid gap-5">
        <PillBlock title="CONEXION">
          <ToggleRow
            title="Activar MDBList Ratings"
            description="Obtiene puntuaciones externas para el hero de la pantalla de detalle."
            checked={settings.enabled}
            onChange={checked => onChange({ enabled: checked })}
          />
          <PillRow
            title="API Key"
            titleAction={(
              <a href="https://mdblist.com/preferences/" target="_blank" rel="noreferrer" className="text-xs font-bold text-white/62 underline underline-offset-2 gsap-transition hover:text-white">
                Obtener API
              </a>
            )}
            description="Requerida para consultar ratings desde MDBList."
          >
            <input
              type="password"
              value={settings.apiKey}
              onChange={event => onChange({ apiKey: event.target.value })}
              placeholder="Tu API key de MDBList"
              className="w-full rounded-full border border-white/18 bg-white px-4 py-2.5 text-sm text-black outline-none gsap-transition placeholder:text-black/45 focus:border-white/34"
            />
          </PillRow>
        </PillBlock>

        <PillBlock title="PROVEEDORES">
          {MDBLIST_PROVIDER_OPTIONS.map(option => (
            <ToggleRow
              key={option.provider}
              title={option.label}
              description={option.description}
              checked={settings[option.settingKey]}
              onChange={checked => onChange({ [option.settingKey]: checked } as Partial<MdbListSettings>)}
            />
          ))}
        </PillBlock>

        <div className="flex items-center gap-3">
          <ActionButton onClick={() => onChange({})} icon={<Save size={15} />}>Guardar MDBList</ActionButton>
          {saved ? <span className="text-sm text-white/54">Guardado.</span> : null}
        </div>

      </div>
    </PanelScaffold>
  );
}

function ManageProfiles({
  profiles,
  activeProfile,
  profileName,
  profilePin,
  profileAvatar,
  saved,
  profileError,
  onProfileNameChange,
  onProfilePinChange,
  onChooseProfileImage,
  onSaveProfile,
  onSwitchProfile,
  onDeleteProfile,
}: {
  profiles: LocalProfile[];
  activeProfile: LocalProfile | null;
  profileName: string;
  profilePin: string;
  profileAvatar?: string;
  saved: boolean;
  profileError: string;
  onProfileNameChange: (value: string) => void;
  onProfilePinChange: (value: string) => void;
  onChooseProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onSaveProfile: () => void;
  onSwitchProfile: (profile: LocalProfile) => void;
  onDeleteProfile: (profile: LocalProfile) => void;
}) {
  const activePreview = activeProfile
    ? { ...activeProfile, name: profileName, pin: profilePin, avatarDataUrl: profileAvatar }
    : null;

  const [confirmDelete, setConfirmDelete] = useState<LocalProfile | null>(null);
  const [deletePin, setDeletePin] = useState("");
  const [deletePinError, setDeletePinError] = useState("");
  const [deletePinVerifying, setDeletePinVerifying] = useState(false);
  const deletePinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (confirmDelete) deletePinRef.current?.focus();
  }, [confirmDelete]);

  async function handleDeletePinSubmit() {
    if (!confirmDelete) return;
    setDeletePinVerifying(true);
    setDeletePinError("");
    if (confirmDelete.pin) {
      const valid = await verifyPin(deletePin, confirmDelete.pin);
      if (!valid) {
        setDeletePinVerifying(false);
        setDeletePinError("PIN incorrecto");
        return;
      }
    }
    onDeleteProfile(confirmDelete);
    setConfirmDelete(null);
    setDeletePin("");
    setDeletePinError("");
    setDeletePinVerifying(false);
  }

  return (
    <div className="grid gap-5">
      <PillBlock title="Cuenta actual">
        {activePreview ? (
          <div className="grid gap-5 p-5 md:grid-cols-[auto,1fr]">
            <div className="flex flex-col items-center gap-3">
              <ProfileAvatar profile={activePreview} className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-white text-black" />
              <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-xs font-bold text-white/72 gsap-transition hover:bg-white/14 hover:text-white">
                <ImagePlus size={14} />
                Cambiar foto
                <input type="file" accept="image/*" onChange={onChooseProfileImage} className="hidden" />
              </label>
            </div>

            <div className="grid gap-4">
              <TextField label="Nombre" value={profileName} placeholder="Nombre del perfil" onChange={onProfileNameChange} />
              <TextField label="PIN opcional" value={profilePin} placeholder="Sin PIN" password numeric onChange={onProfilePinChange} />
              <div className="flex items-center gap-3">
                <ActionButton onClick={onSaveProfile} icon={<Save size={15} />}>Guardar perfil</ActionButton>
                {saved ? <span className="text-sm text-white/54">Guardado.</span> : null}
              </div>
            </div>
          </div>
        ) : null}
      </PillBlock>

      <PillBlock title="Perfiles en este equipo">
        {profiles.map(profile => {
          const isActive = profile.id === activeProfile?.id;
          const isOnlyProfile = profiles.length <= 1;
          return (
            <PillRow key={profile.id} title={profile.name} description={profile.pin ? "PIN activo" : "Sin PIN"} leading={<ProfileAvatar profile={profile} className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white text-black" />}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSwitchProfile(profile)}
                  disabled={isActive}
                  className={clsx(
                    "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-black gsap-transition",
                    isActive ? "bg-white/12 text-white/44" : "bg-white text-black hover:bg-white/86",
                  )}
                >
                  <LogIn size={14} />
                  {isActive ? "Activo" : "Entrar"}
                </button>
                {!isActive || !isOnlyProfile ? (
                  <button
                    type="button"
                    onClick={() => { setConfirmDelete(profile); setDeletePin(""); setDeletePinError(""); }}
                    className="flex shrink-0 items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-xs font-black text-white/44 gsap-transition hover:border-red-500/60 hover:bg-red-500/12 hover:text-red-300"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>
            </PillRow>
          );
        })}
      </PillBlock>

      {profileError ? <p className="text-sm font-semibold text-red-300">{profileError}</p> : null}

      {confirmDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => { setConfirmDelete(null); setDeletePin(""); setDeletePinError(""); }}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-[24px] border border-white/10 bg-[#2a2a2d] p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/20 text-red-400">
                <Trash2 size={20} />
              </div>
              <div>
                <p className="text-base font-black text-white">Eliminar perfil</p>
                <p className="text-sm font-medium text-white/50">Esta acción no se puede deshacer.</p>
              </div>
            </div>
            <p className="mb-4 text-sm leading-6 text-white/60">
              ¿Estás seguro de eliminar el perfil <span className="font-bold text-white">{confirmDelete.name}</span>? Todos los datos
              locales asociados se borrarán permanentemente.
            </p>
            {confirmDelete.pin ? (
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-bold text-white/50">PIN del perfil</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={deletePinRef}
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    value={deletePin}
                    onChange={e => { setDeletePin(e.target.value.replace(/\D/g, "")); setDeletePinError(""); }}
                    onKeyDown={e => { if (e.key === "Enter") void handleDeletePinSubmit(); }}
                    placeholder="Introduce el PIN"
                    autoComplete="off"
                    className="w-full rounded-full border border-white/12 bg-white px-4 py-2.5 text-sm font-semibold text-black outline-none placeholder:text-black/38 focus:border-white/42"
                  />
                </div>
                {deletePinError ? <p className="mt-2 text-xs font-bold text-red-300">{deletePinError}</p> : null}
              </div>
            ) : null}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmDelete(null); setDeletePin(""); setDeletePinError(""); }}
                className="flex-1 rounded-full border border-white/12 px-4 py-2.5 text-sm font-bold text-white/68 gsap-transition hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDeletePinSubmit()}
                disabled={deletePinVerifying || (!!confirmDelete.pin && !deletePin.trim())}
                className="flex-1 rounded-full bg-red-500 px-4 py-2.5 text-sm font-black text-white gsap-transition hover:bg-red-400 disabled:opacity-40"
              >
                {deletePinVerifying ? "Verificando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreateProfile({
  newProfileName,
  newProfilePin,
  newProfileAvatar,
  profileError,
  onNewProfileNameChange,
  onNewProfilePinChange,
  onChooseNewProfileImage,
  onCreateProfile,
}: {
  newProfileName: string;
  newProfilePin: string;
  newProfileAvatar?: string;
  profileError: string;
  onNewProfileNameChange: (value: string) => void;
  onNewProfilePinChange: (value: string) => void;
  onChooseNewProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateProfile: () => void;
}) {
  const newPreview: LocalProfile = {
    id: "new-profile-preview",
    name: newProfileName || "Nuevo",
    pin: newProfilePin || undefined,
    avatarDataUrl: newProfileAvatar,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return (
    <div className="grid gap-5">
      <PillBlock>
        <div className="grid gap-5 p-5 md:grid-cols-[auto,1fr]">
          <div className="flex flex-col items-center gap-3">
            <ProfileAvatar profile={newPreview} className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-white text-black" />
            <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-xs font-bold text-white/72 gsap-transition hover:bg-white/14 hover:text-white">
              <ImagePlus size={14} />
              Foto
              <input type="file" accept="image/*" onChange={onChooseNewProfileImage} className="hidden" />
            </label>
          </div>
          <div className="grid gap-4">
            <TextField label="Nombre" value={newProfileName} placeholder="Nombre de la cuenta" onChange={onNewProfileNameChange} />
            <TextField label="PIN opcional" value={newProfilePin} placeholder="Sin PIN" password numeric onChange={onNewProfilePinChange} />
            <ActionButton onClick={onCreateProfile} icon={<Plus size={15} />}>Crear y entrar</ActionButton>
          </div>
        </div>
      </PillBlock>
      {profileError ? <p className="text-sm font-semibold text-red-300">{profileError}</p> : null}
    </div>
  );
}

function DesignPanel({
  view,
  preferences,
  catalogRows,
  visibleCatalogRows,
  catalogLoading,
  onViewChange,
  onPreferencesChange,
  onToggleCatalog,
  onMoveCatalog,
}: {
  view: DesignView;
  preferences: HomePreferences;
  catalogRows: CatalogRowData[];
  visibleCatalogRows: CatalogRowData[];
  catalogLoading: boolean;
  onViewChange: (view: DesignView) => void;
  onPreferencesChange: (patch: Partial<HomePreferences>) => void;
  onToggleCatalog: (row: CatalogRowData) => void;
  onMoveCatalog: (row: CatalogRowData, direction: "left" | "right") => void;
}) {
  if (view === "home-screen") {
    return (
      <PanelScaffold title="Pantalla de inicio" onBack={() => onViewChange("overview")}>
        <div className="grid gap-5">
          <section>
            <SectionLabel>Contenido principal</SectionLabel>
            <ContentOrientationControl
              value={preferences.contentOrientation}
              onChange={contentOrientation => onPreferencesChange({ contentOrientation })}
            />
            <p className="mt-3 text-xs text-white/36">Prioriza el contenido elegido sin ocultar los demás catálogos.</p>
          </section>

          <PillBlock>
            <ToggleRow
              title="Posters horizontales"
              description="Solo aplica a catálogos. Continuar viendo mantiene su formato actual."
              checked={preferences.posterLayout === "horizontal"}
              onChange={checked => onPreferencesChange({ posterLayout: checked ? "horizontal" : "vertical" })}
            />
          </PillBlock>

          <section>
            <SectionLabel>Reordenar los catálogos</SectionLabel>
            <div className="rounded-[30px] border border-white/10 bg-white/[0.055] p-4">
              {catalogLoading ? (
                <p className="px-2 py-5 text-sm text-white/52">Cargando catálogos...</p>
              ) : catalogRows.length ? (
                <div className="flex max-h-[54vh] flex-col gap-3 overflow-y-auto pr-1">
                  {catalogRows.map((row, index) => {
                    const hidden = preferences.hiddenCatalogKeys.includes(catalogPreferenceKey(row));
                    return (
                      <div
                        key={catalogPreferenceKey(row)}
                        className={clsx(
                          "flex w-full items-center justify-between gap-4 rounded-[24px] border px-4 py-3",
                          hidden ? "border-white/8 bg-black/18 opacity-55" : "border-white/12 bg-black/28",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-white">{cleanCatalogTitle(row.name)}</p>
                          <p className="mt-0.5 text-xs text-white/42">{row.items.length} títulos</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <ToggleSwitch checked={!hidden} onChange={() => onToggleCatalog(row)} />
                          <div className="flex items-center gap-1">
                            <IconButton title="Mover arriba" disabled={index === 0} onClick={() => onMoveCatalog(row, "left")}>
                              <ArrowUp size={15} />
                            </IconButton>
                            <IconButton title="Mover abajo" disabled={index === catalogRows.length - 1} onClick={() => onMoveCatalog(row, "right")}>
                              <ArrowDown size={15} />
                            </IconButton>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-5 text-sm text-white/52">No hay catálogos disponibles.</p>
              )}
            </div>
            <p className="mt-3 text-xs text-white/36">{visibleCatalogRows.length} catálogos activos.</p>
          </section>
        </div>
      </PanelScaffold>
    );
  }

  if (view === "detail-screen") {
    return (
      <PanelScaffold title="Pantalla de detalle" onBack={() => onViewChange("overview")}>
        <PillBlock>
          <ToggleRow
            title="Usar arte de TMDB como respaldo"
            description="Desactivado usa banners, hero y fondos que lleguen del addon. Activado permite completar con TMDB cuando el addon no trae imagen."
            checked={preferences.allowTmdbArtworkFallback}
            onChange={checked => onPreferencesChange({ allowTmdbArtworkFallback: checked })}
          />
        </PillBlock>
      </PanelScaffold>
    );
  }

  return (
    <PanelScaffold title="Diseño">
      <PillBlock>
        <NavRow title="Pantalla de inicio" description="Posters, orden y visibilidad de catálogos." onClick={() => onViewChange("home-screen")} />
        <NavRow title="Pantalla de detalle" description="Fuente de banners y hero." onClick={() => onViewChange("detail-screen")} />
      </PillBlock>
    </PanelScaffold>
  );
}

function ContentOrientationControl({ value, onChange }: { value: ContentOrientation; onChange: (value: ContentOrientation) => void }) {
  const options: Array<{ value: ContentOrientation; label: string }> = [
    { value: "movies-series", label: "Películas y series" },
    { value: "anime", label: "Anime" },
    { value: "both", label: "Ambos" },
  ];

  return (
    <div className="grid gap-2 rounded-[26px] border border-white/10 bg-white/[0.055] p-2 sm:grid-cols-3">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            "gsap-transition rounded-full px-4 py-3 text-sm font-black",
            value === option.value ? "bg-white text-black" : "text-white/54 hover:bg-white/10 hover:text-white",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AddonsPanel({ installedCount, enabledCount, onOpenAddons }: { installedCount: number; enabledCount: number; onOpenAddons: () => void }) {
  return (
    <PanelScaffold title="Complementos">
      <PillBlock>
        <PillRow title="Gestor de complementos" description={`${enabledCount} activos de ${installedCount} instalados.`}>
          <ActionButton onClick={onOpenAddons} icon={<ExternalLink size={15} />}>Abrir</ActionButton>
        </PillRow>
      </PillBlock>
    </PanelScaffold>
  );
}

function PlaybackPanel({
  playback,
  onPlaybackChange,
  saved,
}: {
  playback: PlaybackPreferences;
  onPlaybackChange: <Value extends PlaybackPreferences[keyof PlaybackPreferences]>(name: keyof PlaybackPreferences, value: Value) => void;
  saved: boolean;
}) {
  return (
    <PanelScaffold title="Reproduccion">
      <div className="grid gap-5">
        <PillBlock title="REPRODUCTOR">
          <ToggleRow
            title="Mostrar superposicion de carga"
            description="Mostrar la superposicion de carga inicial mientras empieza a reproducirse un stream."
            checked={playback.showLoadingOverlay}
            onChange={checked => onPlaybackChange("showLoadingOverlay", checked)}
          />
          <ToggleRow
            title="Mantener para acelerar"
            description="Manten pulsado en cualquier parte de la superficie del reproductor para aumentar temporalmente la velocidad."
            checked={playback.holdToAccelerate}
            onChange={checked => onPlaybackChange("holdToAccelerate", checked)}
          />
          <SelectRow
            title="Velocidad al mantener"
            value={String(playback.holdToAccelerateSpeed)}
            options={[
              { value: "1.25", label: "1.25x" },
              { value: "1.5", label: "1.5x" },
              { value: "2", label: "2x" },
              { value: "2.5", label: "2.5x" },
              { value: "3", label: "3x" },
            ]}
            onChange={value => onPlaybackChange("holdToAccelerateSpeed", Number(value))}
          />
        </PillBlock>

        <PillBlock title="SUBTITULOS Y AUDIO">
          <SelectRow title="Idioma de audio preferido" value={playback.firstAudioLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("firstAudioLanguage", value)} />
          <SelectRow title="Idioma de audio secundario" value={playback.secondAudioLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("secondAudioLanguage", value)} />
          <SelectRow title="Idioma de subtítulos preferido" value={playback.preferredSubtitleLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("preferredSubtitleLanguage", value)} />
          <SelectRow title="Idioma de subtítulos secundario" value={playback.secondSubtitleLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("secondSubtitleLanguage", value)} />
        </PillBlock>

        <PillBlock title="SELECCION DE STREAM">
          <ToggleRow
            title="Reutilizar ultimo enlace"
            description="Reproducir automaticamente tu ultimo stream funcional para esta misma pelicula/episodio cuando la cache siga siendo valida."
            checked={playback.reuseLastLink}
            onChange={checked => onPlaybackChange("reuseLastLink", checked)}
          />
        </PillBlock>

        <PillBlock title="REPRODUCCION AUTOMATICA DE STREAMS">
          <SelectRow
            title="Modo de seleccion de stream"
            value={playback.sourceSelectionMode}
            options={[
              { value: "manual", label: "Manual" },
              { value: "first", label: "Autoreproducir primera fuente" },
            ]}
            onChange={value => onPlaybackChange("sourceSelectionMode", value)}
          />
        </PillBlock>

        <PillBlock title="Decoder (Desktop)">
          <SelectRow
            title="Hardware Decoding"
            value={playback.hardwareDecoding}
            options={[
              { value: "auto", label: "Auto (recomendado)" },
              { value: "enabled", label: "Activado" },
              { value: "disabled", label: "Desactivado" },
            ]}
            onChange={value => onPlaybackChange("hardwareDecoding", value)}
          />
          <StaticText>
            Este reproductor usa libmpv integrado. Auto usa hwdec auto-safe y conserva el renderizado dentro de la ventana de Aetherio.
          </StaticText>
        </PillBlock>

        <PillBlock title="SALTAR SEGMENTOS">
          <ToggleRow
            title="Saltar intro/outro/resumen"
            description="Mostrar boton de salto durante segmentos detectados de intro, outro y resumen."
            checked={playback.skipSegmentsEnabled}
            onChange={checked => onPlaybackChange("skipSegmentsEnabled", checked)}
          />
          <ToggleRow
            title="Anime Skip"
            description="Buscar tambien marcas de salto en AnimeSkip (requiere ID de cliente)."
            checked={playback.animeSkipEnabled}
            onChange={checked => onPlaybackChange("animeSkipEnabled", checked)}
          />
          <ToggleRow
            title="Enable Intro Submission"
            description="Show a button to submit intro/outro timestamps to the community database."
            checked={playback.introDbSubmissionEnabled}
            onChange={checked => onPlaybackChange("introDbSubmissionEnabled", checked)}
          />
        </PillBlock>

        <PillBlock title="SIGUIENTE EPISODIO">
          <ToggleRow
            title="Reproduccion automatica del siguiente episodio"
            description="Buscar y reproducir automaticamente el siguiente episodio cuando se alcance el umbral."
            checked={playback.autoPlayNextEpisode}
            onChange={checked => onPlaybackChange("autoPlayNextEpisode", checked)}
          />
          <ToggleRow
            title="Preferir grupo binge"
            description="Al reproducir automaticamente, preferir un stream del mismo grupo binge que el actual."
            checked={playback.preferBingeGroup}
            onChange={checked => onPlaybackChange("preferBingeGroup", checked)}
          />
          <SelectRow title="Modo de umbral" value={playback.nextEpisodeThresholdMode} options={[{ value: "percentage", label: "Porcentaje" }]} onChange={() => onPlaybackChange("nextEpisodeThresholdMode", "percentage")} />
          <RangeRow
            title="Porcentaje de umbral"
            description="Mostrar la tarjeta del siguiente episodio cuando la reproducción alcance este porcentaje."
            value={playback.nextEpisodeThresholdPercent}
            min={50}
            max={100}
            suffix="%"
            onChange={value => onPlaybackChange("nextEpisodeThresholdPercent", value)}
          />
        </PillBlock>

        {saved ? <p className="text-sm text-white/54">Guardado.</p> : null}
      </div>
    </PanelScaffold>
  );
}

function AboutPanel() {
  return (
    <PanelScaffold title="Acerca de">
      <PillBlock>
        <div className="flex items-center gap-5 p-6">
          <img src={aetherioLogo} alt="Aetherio" className="h-20 w-20 rounded-3xl object-contain" />
          <div>
            <h2 className="text-2xl font-black text-white">Aetherio</h2>
            <p className="mt-1 text-sm text-white/52">Version 0.1.0</p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/60">Reproductor de escritorio con perfiles locales, complementos y reproducción integrada en la app.</p>
          </div>
        </div>
      </PillBlock>
    </PanelScaffold>
  );
}

function PanelScaffold({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) {
  return (
    <section>
      <header className="mb-6 flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/8 text-white/70 gsap-transition hover:bg-white/14 hover:text-white"
            title="Volver"
          >
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <h2 className="text-3xl font-black text-white">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function PillBlock({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      <div className="overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.055] shadow-[0_16px_54px_rgba(0,0,0,0.22)]">
        {children}
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-xs font-black text-white/48">{children}</h3>;
}

function NavRow({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 border-b border-white/[0.055] px-5 py-4 text-left gsap-transition last:border-b-0 hover:bg-white/[0.055]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-black text-white">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-white/50">{description}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-white/38" />
    </button>
  );
}

function PillRow({
  title,
  titleAction,
  description,
  leading,
  children,
}: {
  title: ReactNode;
  titleAction?: ReactNode;
  description?: string;
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-white/[0.055] px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-black text-white">{title}</p>
            {titleAction ? <span className="shrink-0">{titleAction}</span> : null}
          </div>
          {description ? <p className="mt-1 text-sm leading-5 text-white/50">{description}</p> : null}
        </div>
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <PillRow title={title} description={description}>
      <ToggleSwitch checked={checked} onChange={() => onChange(!checked)} />
    </PillRow>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={clsx(
        "relative h-8 w-14 rounded-full gsap-transition",
        checked ? "bg-white" : "bg-white/18",
      )}
      aria-pressed={checked}
    >
      <span
        className={clsx(
          "absolute top-1 h-6 w-6 rounded-full gsap-transition",
          checked ? "left-7 bg-black" : "left-1 bg-white/54",
        )}
      />
    </button>
  );
}

function SelectRow({ title, value, options, onChange }: { title: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <PillRow title={title}>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-w-[190px] rounded-full border border-white/12 bg-[#171719] px-4 py-2.5 text-sm font-semibold text-white outline-none gsap-transition focus:border-white/34"
      >
        {options.map(option => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
      </select>
    </PillRow>
  );
}

function RangeRow({
  title,
  description,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  title: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="border-b border-white/[0.055] px-5 py-4 last:border-b-0">
      <div className="mb-4 flex items-start justify-between gap-5">
        <div>
          <p className="text-sm font-black text-white">{title}</p>
          {description ? <p className="mt-1 text-sm leading-5 text-white/50">{description}</p> : null}
        </div>
        <span className="shrink-0 text-sm font-black text-white">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="w-full accent-white"
      />
    </div>
  );
}

function StaticText({ children }: { children: ReactNode }) {
  return <div className="border-b border-white/[0.055] px-5 py-4 text-sm leading-6 text-white/50 last:border-b-0">{children}</div>;
}

function TextField({
  label,
  value,
  placeholder,
  password,
  numeric,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  password?: boolean;
  numeric?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-white/86">{label}</span>
      <input
        type={password ? "password" : "text"}
        inputMode={numeric ? "numeric" : undefined}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-full border border-white/12 bg-white/10 px-4 py-3 text-sm text-white outline-none gsap-transition placeholder:text-white/34 focus:border-white/34"
      />
    </label>
  );
}

function ActionButton({ children, icon, disabled, onClick }: { children: ReactNode; icon?: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-black text-black gsap-transition hover:bg-white/86",
        disabled && "cursor-not-allowed opacity-45 hover:bg-white",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function IconButton({ children, title, disabled, onClick }: { children: ReactNode; title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-full border border-white/12 gsap-transition",
        disabled ? "cursor-default text-white/22" : "text-white/70 hover:bg-white/12 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function getInitialTab(search: string): SettingsTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "account" || tab === "profile" || tab === "services") return "account";
  if (tab === "design" || tab === "addons" || tab === "sources" || tab === "playback" || tab === "about") return tab;
  return "account";
}

function getInitialAccountView(search: string): AccountView {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "services") return "integrations";
  if (tab === "trakt") return "trakt";
  if (tab === "mdblist") return "mdblist";
  return "overview";
}

function cleanCatalogTitle(name: string) {
  return name.replace(/\s*[|.-]\s*.+$/, "").replace(/\s*(ElfHosted|AIOMetadata|Cinemeta)\s*$/i, "").trim();
}

function describeUnknownError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}
