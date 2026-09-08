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
  LogOut,
  Palette,
  PlayCircle,
  Puzzle,
  RadioTower,
  RefreshCw,
  Save,
  Trash2,
  Unlink,
  UserRound,
  Search,
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
import {
  BETTER_POSTER_LANGUAGE_OPTIONS,
  BETTER_POSTER_RATING_SOURCE_OPTIONS,
  getBetterPosterSettings,
  saveBetterPosterSettings,
  type BetterPosterRatingSource,
  type BetterPosterSettings,
} from "../../config/betterPosters";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useProfileGradient } from "../../hooks/useProfileGradient";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData } from "../../types/ui";
import {
  deleteLocalProfile,
  getActiveProfile,
  getLocalProfiles,
  LOCAL_PROFILES_CHANGED_EVENT,
  readImageFileAsDataUrl,
  removeLocalProfilePin,
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
import {
  AETHERIO_AUTH_CHANGED_EVENT,
  AETHERIO_AUTH_ERROR_EVENT,
  connectAniListAccount,
  getStoredAccount,
  leaveLocalMode,
  logoutAccount,
  requestOAuthLinkIntent,
  startSocialLogin,
  type OAuthProvider,
} from "../../auth/authClient";
import { openExternalUrl } from "../../runtime/platform";
import packageJson from "../../../package.json";

type SettingsTab = "account" | "design" | "addons" | "sources" | "playback" | "about";
type AccountView = "overview" | "profiles" | "manage-profiles" | "integrations" | "anime-skip" | "theintrodb" | "trakt" | "mdblist" | "discord";
type DesignView = "overview" | "home-screen" | "detail-screen";
type SavedSections = {
  profile: boolean;
  integrations: boolean;
  mdblist: boolean;
  playback: boolean;
  design: boolean;
};

const EMPTY_SAVED_SECTIONS: SavedSections = {
  profile: false,
  integrations: false,
  mdblist: false,
  playback: false,
  design: false,
};

const SIDEBAR_ITEMS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "account", label: "Cuenta", icon: <UserRound size={17} /> },
  { id: "design", label: "Diseño", icon: <Palette size={17} /> },
  { id: "addons", label: "Complementos", icon: <Puzzle size={17} /> },
  { id: "sources", label: "Fuentes", icon: <RadioTower size={17} /> },
  { id: "playback", label: "Reproducción", icon: <PlayCircle size={17} /> },
  { id: "about", label: "Acerca de", icon: <Info size={17} /> },
];

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const addons = useAddonStore(state => state.addons);
  const { rows: catalogRows, loading: catalogLoading } = useHomeCatalogs(addons);
  const { gradient } = useProfileGradient();
  const homePreferences = useHomePreferences();
  const [localHomePreferences, setLocalHomePreferences] = useState<HomePreferences>(homePreferences);
  const [keys, setKeys] = useState<ApiKeys>(() => getApiKeys());
  const [mdbList, setMdbList] = useState<MdbListSettings>(() => getMdbListSettings());
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => getPlaybackPreferences());
  const [betterPosters, setBetterPosters] = useState<BetterPosterSettings>(() => getBetterPosterSettings());
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => getInitialTab(location.search));
  const [accountView, setAccountView] = useState<AccountView>(() => getInitialAccountView(location.search));
  const [designView, setDesignView] = useState<DesignView>("overview");
  const [saved, setSaved] = useState<SavedSections>(EMPTY_SAVED_SECTIONS);
  const [profiles, setProfiles] = useState<LocalProfile[]>(() => getLocalProfiles());
  const [activeProfile, setActiveProfileState] = useState<LocalProfile | null>(() => getActiveProfile());
  const [profileName, setProfileName] = useState(() => getActiveProfile()?.name ?? "");
  const [profilePin, setProfilePin] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>(() => getActiveProfile()?.avatarDataUrl);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (gradient) {
      document.documentElement.style.setProperty("--aetherio-page-bg", gradient);
    }

    return () => {
      document.documentElement.style.removeProperty("--aetherio-page-bg");
    };
  }, [gradient]);

  useEffect(() => {
    setKeys(getApiKeys());
    setMdbList(getMdbListSettings());
    setPlayback(getPlaybackPreferences());
    setBetterPosters(getBetterPosterSettings());
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
      setProfilePin("");
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
    setSaved(EMPTY_SAVED_SECTIONS);
    setActiveTab(tab);
    setAccountView("overview");
    setDesignView("overview");
    navigate(`/settings?tab=${tab}`, { replace: true });
  }

  function updateKey(name: keyof ApiKeys, value: string) {
    setSaved(current => ({ ...current, integrations: false }));
    setKeys(current => ({ ...current, [name]: value }));
  }

  function saveIntegrations() {
    saveApiKeys(keys);
    setSaved(current => ({ ...current, integrations: true }));
  }

  function updatePlayback<Value extends PlaybackPreferences[keyof PlaybackPreferences]>(name: keyof PlaybackPreferences, value: Value) {
    setSaved(current => ({ ...current, playback: true }));
    setPlayback(current => {
      const next = { ...current, [name]: value };
      savePlaybackPreferences(next);
      return next;
    });
  }

  function updateMdbList(patch: Partial<MdbListSettings>, persist = true) {
    setMdbList(current => {
      const next = { ...current, ...patch };
      if (persist) {
        const persisted = patch.apiKey === undefined
          ? { ...next, apiKey: getMdbListSettings().apiKey }
          : next;
        saveMdbListSettings(persisted);
      }
      return next;
    });
    setSaved(current => ({ ...current, mdblist: persist }));
  }

  function saveMdbListApiKey() {
    saveMdbListSettings(mdbList);
    setSaved(current => ({ ...current, mdblist: true }));
  }

  function updateBetterPosters(patch: Partial<BetterPosterSettings>) {
    setBetterPosters(current => {
      const next = { ...current, ...patch };
      saveBetterPosterSettings(next);
      return next;
    });
    setSaved(current => ({ ...current, design: true }));
  }

  function updateHomePreferences(patch: Partial<HomePreferences>) {
    const next = { ...localHomePreferences, ...patch };
    setSaved(current => ({ ...current, design: true }));
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

  async function chooseProfileImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setProfileAvatar(dataUrl);
      setProfileError("");
      setSaved(current => ({ ...current, profile: false }));
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
    setSaved(current => ({ ...current, profile: true }));
    if (updated) setActiveProfileState(updated);
    setProfilePin("");
    setProfiles(getLocalProfiles());
  }

  function removeProfilePin() {
    if (!activeProfile || !removeLocalProfilePin(activeProfile.id)) return;
    setProfilePin("");
    setActiveProfileState(getActiveProfile());
    setProfiles(getLocalProfiles());
    setProfileError("");
    setSaved(current => ({ ...current, profile: true }));
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
      setProfilePin("");
      setProfileAvatar(remaining[0]?.avatarDataUrl);
      setSaved(current => ({ ...current, profile: false }));
      setProfileError("");
    }
    setProfiles(remaining);
  }

  return (
    <PageContainer className="min-h-screen py-5 lg:py-8">
      <div className="mx-auto grid max-w-[1360px] grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
        <aside className="self-start lg:sticky lg:top-4">
          <h1 className="mb-5 px-2 text-3xl font-black text-white">Ajustes</h1>
          <nav className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-white/[0.055] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.34)] sm:grid-cols-3 lg:block lg:rounded-[30px]">
            {SIDEBAR_ITEMS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={clsx(
                  "flex w-full min-w-0 items-center gap-3 rounded-full px-4 py-3 text-left text-sm font-black lg:mb-1 lg:last:mb-0",
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
              profileError={profileError}
              saved={saved}
              keys={keys}
              mdbList={mdbList}
              onViewChange={setAccountView}
              onProfileNameChange={value => {
                setSaved(current => ({ ...current, profile: false }));
                setProfileName(value);
              }}
              onProfilePinChange={value => {
                setSaved(current => ({ ...current, profile: false }));
                setProfilePin(value.replace(/\D/g, "").slice(0, 8));
              }}
              onChooseProfileImage={chooseProfileImage}
              onSaveProfile={saveProfile}
              onRemoveProfilePin={removeProfilePin}
              onStartProfileQuickStart={() => navigate("/quick-start/profile")}
              onSwitchProfile={switchProfile}
              onDeleteProfile={deleteProfile}
              onKeyChange={updateKey}
              onNavigateToProfiles={() => navigate("/profiles")}
              onMdbListChange={updateMdbList}
              onSaveMdbListApiKey={saveMdbListApiKey}
              onSaveIntegrations={saveIntegrations}
              playback={playback}
              onPlaybackChange={updatePlayback}
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
              betterPosters={betterPosters}
              onBetterPostersChange={updateBetterPosters}
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
            <PlaybackPanel playback={playback} onPlaybackChange={updatePlayback} saved={saved.playback} />
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
  profileError,
  saved,
  keys,
  mdbList,
  onViewChange,
  onProfileNameChange,
  onProfilePinChange,
  onChooseProfileImage,
  onSaveProfile,
  onRemoveProfilePin,
  onStartProfileQuickStart,
  onSwitchProfile,
  onDeleteProfile,
  onKeyChange,
  onMdbListChange,
  onSaveMdbListApiKey,
  onSaveIntegrations,
  onNavigateToProfiles,
  playback,
  onPlaybackChange,
}: {
  view: AccountView;
  profiles: LocalProfile[];
  activeProfile: LocalProfile | null;
  profileName: string;
  profilePin: string;
  profileAvatar?: string;
  profileError: string;
  saved: SavedSections;
  keys: ApiKeys;
  mdbList: MdbListSettings;
  onViewChange: (view: AccountView) => void;
  onProfileNameChange: (value: string) => void;
  onProfilePinChange: (value: string) => void;
  onChooseProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onSaveProfile: () => void;
  onRemoveProfilePin: () => void;
  onStartProfileQuickStart: () => void;
  onSwitchProfile: (profile: LocalProfile) => void;
  onDeleteProfile: (profile: LocalProfile) => void;
  onKeyChange: (name: keyof ApiKeys, value: string) => void;
  onNavigateToProfiles: () => void;
  onMdbListChange: (patch: Partial<MdbListSettings>, persist?: boolean) => void;
  onSaveMdbListApiKey: () => void;
  onSaveIntegrations: () => void;
  playback: PlaybackPreferences;
  onPlaybackChange: <Value extends PlaybackPreferences[keyof PlaybackPreferences]>(name: keyof PlaybackPreferences, value: Value) => void;
}) {
const [account, setAccount] = useState(() => getStoredAccount());
  const [linkBusy, setLinkBusy] = useState<OAuthProvider | null>(null);
  const [linkStatus, setLinkStatus] = useState("");
  const [linkError, setLinkError] = useState("");
  const [traktAuth, setTraktAuth] = useState(() => getTraktAuthSnapshot());
  const [traktStatus, setTraktStatus] = useState("");
  const [traktError, setTraktError] = useState("");
  const [traktBusy, setTraktBusy] = useState(false);

  useEffect(() => {
    const refresh = (event: Event) => {
      const nextAccount = getStoredAccount();
      setAccount(nextAccount);
      setLinkBusy(null);
      if (event.type === AETHERIO_AUTH_CHANGED_EVENT && nextAccount) {
        setLinkStatus("Cuenta vinculada correctamente.");
      }
    };
    const onAuthError = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      if (message) {
        setLinkError(message);
        setLinkStatus("");
      }
    };
    window.addEventListener(AETHERIO_AUTH_CHANGED_EVENT, refresh);
    window.addEventListener(AETHERIO_AUTH_ERROR_EVENT, onAuthError);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(AETHERIO_AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener(AETHERIO_AUTH_ERROR_EVENT, onAuthError);
      window.removeEventListener("storage", refresh);
    };
  }, []);

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
      setTraktStatus("Autoriza Aetherio en Trakt. Volverás automáticamente a la app.");
      setTraktBusy(false);
    } catch (error) {
      setTraktError(describeUnknownError(error, "No se pudo iniciar la conexión con Trakt."));
      setTraktBusy(false);
    }
  }

  async function connectProvider(provider: OAuthProvider) {
    setLinkBusy(provider);
    setLinkError("");
    setLinkStatus("");
    try {
      if (provider === "anilist") {
        await connectAniListAccount();
      } else {
        const intentToken = await requestOAuthLinkIntent("google");
        await startSocialLogin("google", intentToken);
      }
      setLinkStatus("Autoriza la conexión en el navegador. Volverás automáticamente a la app.");
    } catch (error) {
      setLinkError(describeUnknownError(error, "No se pudo iniciar la conexión."));
    } finally {
      setLinkBusy(null);
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
          saved={saved.profile}
          profileError={profileError}
          onProfileNameChange={onProfileNameChange}
          onProfilePinChange={onProfilePinChange}
          onChooseProfileImage={onChooseProfileImage}
          onSaveProfile={onSaveProfile}
          onRemoveProfilePin={onRemoveProfilePin}
          onSwitchProfile={onSwitchProfile}
          onDeleteProfile={onDeleteProfile}
        />
      </PanelScaffold>
    );
  }

  if (view === "integrations") {
    return (
      <PanelScaffold title="Integraciones" onBack={() => onViewChange("overview")}>
        <PillBlock>
          <NavRow title="MDBList" description="Configura ratings externos para la pantalla de detalle." onClick={() => onViewChange("mdblist")} />
          <NavRow title="Anime skip" description="Usa Anime Skip para detectar intros en anime cuando tengas un Client ID." onClick={() => onViewChange("anime-skip")} />
          <NavRow title="TheIntroDB" description="Timestamps de créditos (outros) para disparar Up Next en películas y series." onClick={() => onViewChange("theintrodb")} />
          <NavRow title="Trakt.tv" description="Sincroniza progreso, historial visto y scrobbling con Trakt por perfil local." onClick={() => onViewChange("trakt")} />
          <NavRow title="Discord Rich Presence" description="Muestra en Discord lo que estás viendo en Aetherio." onClick={() => onViewChange("discord")} />
        </PillBlock>
      </PanelScaffold>
    );
  }

  if (view === "discord") {
    return (
      <PanelScaffold title="Discord Rich Presence" onBack={() => onViewChange("integrations")}>
        <PillBlock>
          <ToggleRow
            title="Mostrar que estoy viendo en Discord"
            description="Aetherio conecta con Discord localmente y muestra la película o serie que se está reproduciendo. No se envía información a ningún servidor."
            checked={playback.enableDiscordRichPresence}
            onChange={checked => onPlaybackChange("enableDiscordRichPresence", checked)}
          />
        </PillBlock>
        <p className="text-xs text-white/36">La presencia se actualiza solo mientras reproduces contenido en el reproductor de escritorio.</p>
        {saved.playback ? <span className="text-sm text-white/54">Guardado.</span> : null}
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
                  ? "Scrobbling y sincronización activos para este perfil."
                  : traktAuth.authorizationPending
                    ? "Termina la autorización en Trakt o vuelve a abrir la página de conexión."
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
        saved={saved.mdblist}
        onBack={() => onViewChange("integrations")}
        onChange={onMdbListChange}
        onSaveApiKey={onSaveMdbListApiKey}
      />
    );
  }

  if (view === "anime-skip") {
    const details = {
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
              <a
                href={details.docsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={event => { event.preventDefault(); void openExternalUrl(details.docsUrl); }}
                className="text-xs font-bold text-white/62 underline underline-offset-2 gsap-transition hover:text-white"
              >
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
          <ActionButton onClick={onSaveIntegrations} icon={<Save size={15} />}>Guardar integración</ActionButton>
          {saved.integrations ? <span className="text-sm text-white/54">Guardado.</span> : null}
        </div>
      </PanelScaffold>
    );
  }

  if (view === "theintrodb") {
    return (
      <PanelScaffold title="TheIntroDB" onBack={() => onViewChange("integrations")}>
        <PillBlock>
          <PillRow
            title="Token de TheIntroDB"
            description="Proporciona timestamps exactos de créditos (outros) para películas y series. Aetherio los usa para mostrar Up Next justo cuando empiezan los créditos; si no hay dato, se usa el umbral por porcentaje."
          >
            <input
              type="password"
              value={keys.introDbApiKey}
              onChange={event => onKeyChange("introDbApiKey", event.target.value)}
              placeholder="Pega aquí tu token de theintrodb.org"
              className="w-full rounded-full border border-white/18 bg-white px-4 py-2.5 text-sm text-black outline-none gsap-transition placeholder:text-black/45 focus:border-white/34"
            />
          </PillRow>
        </PillBlock>
        <div className="mt-5 flex items-center gap-3">
          <ActionButton onClick={onSaveIntegrations} icon={<Save size={15} />}>Guardar integración</ActionButton>
          {saved.integrations ? <span className="text-sm text-white/54">Guardado.</span> : null}
        </div>
      </PanelScaffold>
    );
  }

return (
    <PanelScaffold title="Cuenta">
      <PillBlock>
        {account ? (
          <PillRow
            title={account.displayName}
            description={account.email}
          >
            <ActionButton onClick={() => void logoutAccount()} icon={<LogOut size={15} />}>
              Cerrar sesión
            </ActionButton>
          </PillRow>
        ) : (
          <PillRow
            title="Modo local"
            description="Tus perfiles permanecen sólo en este dispositivo. Puedes conectar una cuenta cuando quieras."
          >
            <ActionButton onClick={leaveLocalMode} icon={<LogIn size={15} />}>
              Conectar cuenta
            </ActionButton>
          </PillRow>
        )}
        {account ? (
          <>
            <PillRow title="Google" description="Entra a tu cuenta con Google.">
              <ActionButton
                onClick={() => void connectProvider("google")}
                icon={<ExternalLink size={15} />}
                disabled={linkBusy !== null}
              >
                {linkBusy === "google" ? "Abriendo Google…" : "Vincular Google"}
              </ActionButton>
            </PillRow>
            <PillRow title="AniList" description="Sincroniza tu biblioteca de anime y conéctala a tu cuenta.">
              <ActionButton
                onClick={() => void connectProvider("anilist")}
                icon={<ExternalLink size={15} />}
                disabled={linkBusy !== null}
              >
                {linkBusy === "anilist" ? "Abriendo AniList…" : "Vincular AniList"}
              </ActionButton>
            </PillRow>
            {linkError ? <p className="px-4 pb-3 text-sm text-red-300">{linkError}</p> : null}
            {linkStatus ? <p className="px-4 pb-3 text-sm text-white/54">{linkStatus}</p> : null}
          </>
        ) : null}
        <NavRow title="Perfiles" description="Administrar perfiles locales o crear nuevos." onClick={() => onViewChange("profiles")} />
        <NavRow title="Integraciones" description="Configurar MDBList, Anime Skip, Trakt y Discord." onClick={() => onViewChange("integrations")} />
      </PillBlock>
    </PanelScaffold>
  );
}

function MdbListPanel({
  settings,
  saved,
  onBack,
  onChange,
  onSaveApiKey,
}: {
  settings: MdbListSettings;
  saved: boolean;
  onBack: () => void;
  onChange: (patch: Partial<MdbListSettings>, persist?: boolean) => void;
  onSaveApiKey: () => void;
}) {
  return (
    <PanelScaffold title="MDBList" onBack={onBack}>
      <div className="grid gap-5">
          <PillBlock title="CONEXIÓN">
          <ToggleRow
            title="Activar MDBList Ratings"
            description="Obtiene puntuaciones externas para el hero de la pantalla de detalle."
            checked={settings.enabled}
            onChange={checked => onChange({ enabled: checked })}
          />
          <PillRow
            title="API Key"
            titleAction={(
              <a
                href="https://mdblist.com/preferences/"
                target="_blank"
                rel="noreferrer"
                onClick={event => { event.preventDefault(); void openExternalUrl("https://mdblist.com/preferences/"); }}
                className="text-xs font-bold text-white/62 underline underline-offset-2 gsap-transition hover:text-white"
              >
                Obtener API
              </a>
            )}
            description="Requerida para consultar ratings desde MDBList."
          >
            <input
              type="password"
              value={settings.apiKey}
              onChange={event => onChange({ apiKey: event.target.value }, false)}
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
          <ActionButton onClick={onSaveApiKey} icon={<Save size={15} />}>Guardar API key</ActionButton>
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
  onRemoveProfilePin,
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
  onRemoveProfilePin: () => void;
  onSwitchProfile: (profile: LocalProfile) => void;
  onDeleteProfile: (profile: LocalProfile) => void;
}) {
  const activePreview = activeProfile
    ? { ...activeProfile, name: profileName, avatarDataUrl: profileAvatar }
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
              <ProfileAvatar profile={activePreview} className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full" />
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
                {activePreview.pin ? (
                  <button
                    type="button"
                    onClick={onRemoveProfilePin}
                    className="rounded-full border border-white/12 px-4 py-2 text-xs font-black text-white/58 gsap-transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-200"
                  >
                    Quitar PIN
                  </button>
                ) : null}
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
            <PillRow key={profile.id} title={profile.name} description={profile.pin ? "PIN activo" : "Sin PIN"} leading={<ProfileAvatar profile={profile} className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full" />}>
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
  betterPosters,
  onBetterPostersChange,
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
  betterPosters: BetterPosterSettings;
  onBetterPostersChange: (patch: Partial<BetterPosterSettings>) => void;
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

          <PillBlock title="PÓSTERS BETTERPOSTERS (BTTTR.CC)">
            <ToggleRow
              title="Usar BetterPosters"
              description="Pósters con etiquetas de género, rating y tendencias. Activado por defecto; si falla una imagen se usa el póster original."
              checked={betterPosters.enabled}
              onChange={checked => onBetterPostersChange({ enabled: checked })}
            />
            <ToggleRow
              title="Etiquetas de tendencia"
              description="Trending, Nuevo, IMDb #3."
              checked={betterPosters.trendTags}
              onChange={checked => onBetterPostersChange({ trendTags: checked })}
            />
            <ToggleRow
              title="Género en el póster"
              description="Etiqueta de género en la parte inferior."
              checked={betterPosters.showGenre}
              onChange={checked => onBetterPostersChange({ showGenre: checked })}
            />
            <ToggleRow
              title="Rating en el póster"
              description="Estrella con puntuación en la parte inferior."
              checked={betterPosters.showRating}
              onChange={checked => onBetterPostersChange({ showRating: checked })}
            />
            <ToggleRow
              title="Sellos de calidad"
              description="Insignias 4K, Dolby Vision, Atmos."
              checked={betterPosters.qualityTags}
              onChange={checked => onBetterPostersChange({ qualityTags: checked })}
            />
            <ToggleRow
              title="Clasificación por edad"
              description="PG-13, TV-MA, R."
              checked={betterPosters.ageRating}
              onChange={checked => onBetterPostersChange({ ageRating: checked })}
            />
            <SelectRow
              title="Fuente del rating"
              value={betterPosters.ratingSource}
              options={BETTER_POSTER_RATING_SOURCE_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
              onChange={value => onBetterPostersChange({ ratingSource: value as BetterPosterRatingSource })}
            />
            <SelectRow
              title="Idioma del póster"
              value={betterPosters.lang}
              options={BETTER_POSTER_LANGUAGE_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
              onChange={value => onBetterPostersChange({ lang: value })}
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
    <PanelScaffold title="Reproducción">
      <div className="grid gap-5">
        <PillBlock title="REPRODUCTOR">
          <ToggleRow
            title="Mostrar superposición de carga"
            description="Mostrar la superposición de carga inicial mientras empieza a reproducirse un stream."
            checked={playback.showLoadingOverlay}
            onChange={checked => onPlaybackChange("showLoadingOverlay", checked)}
          />
          <ToggleRow
            title="Mantener Espacio para acelerar"
            description="Un toque corto reproduce o pausa. Al mantener la barra espaciadora, el vídeo acelera según la velocidad elegida."
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

        <PillBlock title="SUBTÍTULOS Y AUDIO">
          <SelectRow title="Idioma de audio preferido" value={playback.firstAudioLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("firstAudioLanguage", value)} />
          <SelectRow title="Idioma de audio secundario" value={playback.secondAudioLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("secondAudioLanguage", value)} />
          <SelectRow title="Idioma de subtítulos preferido" value={playback.preferredSubtitleLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("preferredSubtitleLanguage", value)} />
          <SelectRow title="Idioma de subtítulos secundario" value={playback.secondSubtitleLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("secondSubtitleLanguage", value)} />
        </PillBlock>

        <PillBlock title="SELECCION DE STREAM">
          <ToggleRow
            title="Reutilizar último enlace"
            description="Reproducir automáticamente tu último stream funcional para esta misma película/episodio cuando la caché siga siendo válida."
            checked={playback.reuseLastLink}
            onChange={checked => onPlaybackChange("reuseLastLink", checked)}
          />
        </PillBlock>

        <PillBlock title="REPRODUCCIÓN AUTOMÁTICA DE STREAMS">
          <SelectRow
            title="Modo de selección de stream"
            value={playback.sourceSelectionMode}
            options={[
              { value: "manual", label: "Manual" },
              { value: "first", label: "Autoreproducir primera fuente" },
            ]}
            onChange={value => onPlaybackChange("sourceSelectionMode", value)}
          />
        </PillBlock>

        <PillBlock title="VIDEO Y AUDIO (DESKTOP)">
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
            libmpv usa GPU Next con D3D11, decodificación por hardware y negociación HDR automática con la pantalla.
          </StaticText>
          <ToggleRow
            title="Passthrough de audio avanzado"
            description="Envía AC3, E-AC3/Atmos, DTS, DTS-HD y TrueHD/Atmos sin decodificar a un receptor compatible. Déjalo apagado para altavoces normales."
            checked={playback.audioPassthrough}
            onChange={checked => onPlaybackChange("audioPassthrough", checked)}
          />
        </PillBlock>

        <PillBlock title="SALTAR SEGMENTOS">
          <ToggleRow
            title="Saltar intro/outro/resumen"
            description="Mostrar botón de salto durante segmentos detectados de intro, outro y resumen."
            checked={playback.skipSegmentsEnabled}
            onChange={checked => onPlaybackChange("skipSegmentsEnabled", checked)}
          />
          <ToggleRow
            title="Anime Skip"
            description="Buscar también marcas de salto en AnimeSkip (requiere ID de cliente)."
            checked={playback.animeSkipEnabled}
            onChange={checked => onPlaybackChange("animeSkipEnabled", checked)}
          />
        </PillBlock>

        <PillBlock title="SIGUIENTE EPISODIO">
          <ToggleRow
            title="Reproducción automática del siguiente episodio"
            description="Buscar y reproducir automáticamente el siguiente episodio cuando se alcance el umbral."
            checked={playback.autoPlayNextEpisode}
            onChange={checked => onPlaybackChange("autoPlayNextEpisode", checked)}
          />
          <ToggleRow
            title="Preferir grupo binge"
            description="Al reproducir automáticamente, preferir un stream del mismo grupo binge que el actual."
            checked={playback.preferBingeGroup}
            onChange={checked => onPlaybackChange("preferBingeGroup", checked)}
          />
<SelectRow
            title="Modo de umbral"
            value={playback.nextEpisodeThresholdMode}
            options={[
              { value: "percentage", label: "Porcentaje" },
              { value: "minutes", label: "Minutos antes del final" },
            ]}
            onChange={value => onPlaybackChange("nextEpisodeThresholdMode", value)}
          />
          {playback.nextEpisodeThresholdMode === "minutes" ? (
            <RangeRow
              title="Minutos antes del final"
              description="Pasar automáticamente al siguiente episodio cuando queden estos minutos. Igual que NuvioTV (0-3.5 min)."
              value={playback.nextEpisodeThresholdMinutesBeforeEnd}
              min={0}
              max={3.5}
              step={0.5}
              suffix=" min"
              onChange={value => onPlaybackChange("nextEpisodeThresholdMinutesBeforeEnd", value)}
            />
          ) : (
            <RangeRow
              title="Porcentaje de umbral"
              description="Pasar automáticamente al siguiente episodio cuando la reproducción alcance este porcentaje. Si hay outro detectado y termina pegado al final, se dispara al empezar los créditos (igual que NuvioTV)."
              value={playback.nextEpisodeThresholdPercent}
              min={97}
              max={100}
              suffix="%"
              onChange={value => onPlaybackChange("nextEpisodeThresholdPercent", value)}
            />
          )}
        </PillBlock>

        <PillBlock title="UP NEXT">
          <ToggleRow
            title="Recomendación al terminar"
            description="Al terminar una película o el último episodio, mostrar una recomendación relacionada con mini reproductor (el video sigue sonando achicado)."
            checked={playback.upNextEnabled}
            onChange={checked => onPlaybackChange("upNextEnabled", checked)}
          />
          <RangeRow
            title="Umbral de película"
            description="Mostrar la recomendación cuando la película alcance este porcentaje (igual que NuvioTV: 80-100%). Si hay créditos detectados, se dispara al empezar los créditos."
            value={playback.postPlayMovieThresholdPercent}
            min={80}
            max={100}
            suffix="%"
            onChange={value => onPlaybackChange("postPlayMovieThresholdPercent", value)}
          />
        </PillBlock>

        {saved ? <p className="text-sm text-white/54">Guardado.</p> : null}
      </div>
    </PanelScaffold>
  );
}

function AboutPanel() {
  const [appVersion, setAppVersion] = useState(packageJson.version ?? "desconocida");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const pendingUpdateRef = useRef<{ version: string; downloadAndInstall: () => Promise<void> } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (v) setAppVersion(v);
      } catch {}
    })();
  }, []);

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setUpdateMessage(null);
    setUpdateReady(false);
    pendingUpdateRef.current = null;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ timeout: 15_000 });
      if (update) {
        pendingUpdateRef.current = update;
        setUpdateReady(true);
        setUpdateMessage(`Nueva versión disponible: v${update.version}`);
      } else {
        setUpdateMessage("Ya tienes la última versión.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
      setUpdateMessage(`No se pudo verificar actualizaciones: ${msg}`);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    const update = pendingUpdateRef.current;
    if (!update || installingUpdate) return;
    setInstallingUpdate(true);
    setUpdateMessage(`Descargando e instalando v${update.version}… No cierres la app.`);
    try {
      await update.downloadAndInstall();
      setUpdateMessage("Actualización instalada. Reiniciando…");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
      setUpdateMessage(`No se pudo instalar la actualización: ${msg}`);
    } finally {
      setInstallingUpdate(false);
    }
  }

  return (
    <PanelScaffold title="Acerca de">
      <PillBlock>
        <div className="flex items-center gap-5 p-6">
          <img src={aetherioLogo} alt="Logo de la aplicación Aetherio" className="h-20 w-20 rounded-3xl object-contain" />
          <div>
            <p className="text-xl font-black text-white">Aetherio</p>
            <p className="mt-1 text-sm text-white/52">Version {appVersion}</p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/60">Reproductor de escritorio con perfiles locales, complementos y reproducción integrada en la app.</p>
          </div>
        </div>
      </PillBlock>

      <PillBlock title="Actualizaciones">
        <div className="p-6 space-y-3">
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={checkingUpdate}
            className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/8 px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/14 hover:text-white disabled:opacity-50"
          >
            <Search size={15} className={checkingUpdate ? "animate-spin" : ""} />
            {checkingUpdate ? "Buscando…" : "Buscar actualizaciones"}
          </button>
          {updateReady && !installingUpdate ? (
            <button
              type="button"
              onClick={() => void handleInstallUpdate()}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-black text-black transition-colors hover:bg-white/86"
            >
              Instalar actualización
            </button>
          ) : null}
          {installingUpdate ? (
            <p className="text-sm font-semibold text-white/80">Instalando… No cierres la app.</p>
          ) : null}
          {updateMessage ? (
            <p className="text-sm text-white/60">{updateMessage}</p>
          ) : null}
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
  step,
  suffix,
  onChange,
}: {
  title: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
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
        step={step ?? 1}
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
  return name
    .replace(/\s*\|.+$/, "")
    .replace(/\s*\.\s*.+$/, "")
    .replace(/\s*(ElfHosted|AIOMetadata|Cinemeta)\s*$/i, "")
    .trim() || name.trim();
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
