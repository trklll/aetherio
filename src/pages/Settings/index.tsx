import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  LogIn,
  LogOut,
  RefreshCw,
  Trash2,
  Unlink,
  ChevronRight,
} from "lucide-react";
import AppleSpinner from "../../components/ui/AppleSpinner";
import aetherioLogo from "../../assets/aetheriologo.png";
import ProfileAvatar from "../../components/profile/ProfileAvatar";
import { saveDownloadsEnabled, useDownloadsEnabled } from "../../config/downloadPreferences";
import SourcesPanel from "./SourcesPanel";
import ToggleSwitch from "../../components/ui/ToggleSwitch";
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
  type BothContentPreference,
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
  getSpatialPosterSettings,
  saveSpatialPosterSettings,
  type SpatialPosterSettings,
} from "../../config/spatialPosters";
import { useHomeCatalogs } from "../../hooks/useCatalogs";
import { useAddonStore } from "../../store/addonStore";
import type { CatalogRowData } from "../../types/ui";
import {
  deleteLocalProfile,
  getActiveProfile,
  getLocalProfiles,
  LOCAL_PROFILES_CHANGED_EVENT,
  PIN_LENGTH,
  pinLengthError,
  readImageFileAsDataUrl,
  removeLocalProfilePin,
  setActiveProfile,
  updateLocalProfile,
  verifyPin,
  type LocalProfile,
} from "../../utils/localProfiles";
import {
  disconnectGoogleDrive,
  getGoogleDriveAuthSnapshot,
  startGoogleDriveAuthorization,
  syncGoogleDriveNow,
  GDRIVE_AUTH_CHANGED_EVENT,
  GDRIVE_SYNC_CHANGED_EVENT,
} from "../../gdrive";
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
import { isBigPictureLocation } from "../../utils/bigPictureDetail";
import packageJson from "../../../package.json";
import PinPad from "../../components/pin/PinPad.tsx";
import NameKeyboard, { type KeyboardMode } from "../../components/quickstart/NameKeyboard.tsx";
import "../../components/quickstart/QuickStartProfile.css";
import LibrarySyncSettings from "../../components/library/LibrarySyncSettings";
import { ChoiceSetting, PopupSetting, SettingsDialog, SettingsHelpDescription, SettingsHelpProvider, SettingsRow } from "./SettingsSurface";
import { getSteppedRangeValue, requestRangeInputValue, updateRangeInput } from "../../utils/rangeInput";
import SettingsCategoryIcon, { type SettingsCategory } from "./SettingsCategoryIcon";
import "./Settings.css";

type SettingsTab = SettingsCategory;
type AccountView = "overview" | "profiles" | "manage-profiles" | "integrations" | "library-sync" | "anime-skip" | "theintrodb" | "gdrive" | "mdblist" | "discord";
type DesignView = "overview" | "home-screen" | "detail-screen";
type SavedSections = {
  integrations: boolean;
  mdblist: boolean;
  playback: boolean;
  design: boolean;
};

const EMPTY_SAVED_SECTIONS: SavedSections = {
  integrations: false,
  mdblist: false,
  playback: false,
  design: false,
};

const SIDEBAR_ITEMS: { id: SettingsTab; label: string; description: string }[] = [
  { id: "account", label: "Cuenta", description: "Gestiona tu cuenta, tus perfiles locales y las integraciones de tu biblioteca." },
  { id: "design", label: "Diseño", description: "Personaliza la pantalla de inicio, los pósters y las imágenes de cada título." },
  { id: "addons", label: "Complementos", description: "Gestiona los complementos que aportan catálogos y enlaces de reproducción." },
  ...(import.meta.env.DEV ? [{ id: "sources" as const, label: "Fuentes", description: "Configura los servicios y proveedores de contenido. Solo disponible en desarrollo." }] : []),
  { id: "playback", label: "Reproducción", description: "Elige tus idiomas de audio y subtítulos, configura el vídeo y decide cómo continuar viendo." },
  { id: "about", label: "Acerca de", description: "Consulta la versión de Aetherio y comprueba si hay actualizaciones." },
];

export default function SettingsPage({ tv = false }: { tv?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const downloadsEnabled = useDownloadsEnabled();
  const addons = useAddonStore(state => state.addons);
  const { rows: catalogRows, loading: catalogLoading } = useHomeCatalogs(addons);
  const homePreferences = useHomePreferences();
  const [localHomePreferences, setLocalHomePreferences] = useState<HomePreferences>(homePreferences);
  const [keys, setKeys] = useState<ApiKeys>(() => getApiKeys());
  const [mdbList, setMdbList] = useState<MdbListSettings>(() => getMdbListSettings());
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => getPlaybackPreferences());
  const [spatialPosters, setSpatialPosters] = useState<SpatialPosterSettings>(() => getSpatialPosterSettings());
  const [activeTab, setActiveTab] = useState<SettingsTab | null>(() => getInitialTab(location.search));
  const [focusedCategory, setFocusedCategory] = useState<SettingsTab>(() => getInitialTab(location.search) ?? "account");
  const [accountView, setAccountView] = useState<AccountView>(() => getInitialAccountView(location.search));
  const [designView, setDesignView] = useState<DesignView>("overview");
  const [saved, setSaved] = useState<SavedSections>(EMPTY_SAVED_SECTIONS);
  const [profiles, setProfiles] = useState<LocalProfile[]>(() => getLocalProfiles());
  const [activeProfile, setActiveProfileState] = useState<LocalProfile | null>(() => getActiveProfile());
  const [focusedProfileId, setFocusedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState(() => getActiveProfile()?.name ?? "");
  const [profilePin, setProfilePin] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>(() => getActiveProfile()?.avatarDataUrl);
  const [profileError, setProfileError] = useState("");
  const [profileEditView, setProfileEditView] = useState<"name" | "pin" | null>(null);
  const [nameKeyboardMode, setNameKeyboardMode] = useState<KeyboardMode>("abc");
  const [switchTarget, setSwitchTarget] = useState<LocalProfile | null>(null);
  const [switchPin, setSwitchPin] = useState("");
  const [switchError, setSwitchError] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);
  const surfaceRef = useRef<HTMLElement>(null);
  const profileEditorExitRef = useRef<(() => void) | null>(null);
  // Rows are remounted between levels; remember their stable labels, not DOM nodes.
  const focusMemory = useRef(new Map<string, string>());
  const profileEditReturnLabel = useRef<string | null>(null);
  const pageKey = `${activeTab ?? "root"}:${activeTab === "account" ? accountView : activeTab === "design" ? designView : "overview"}`;
  const focusedProfile = profiles.find(profile => profile.id === focusedProfileId) ?? activeProfile;
  const identityProfileAvatar = accountView === "manage-profiles" && activeTab === "account"
    ? focusedProfile?.id === activeProfile?.id ? profileAvatar ?? focusedProfile?.avatarDataUrl : focusedProfile?.avatarDataUrl
    : undefined;

  useLayoutEffect(() => {
    let frame = 0;
    let attempts = 0;
    const focusWhenVisible = () => {
      if (document.querySelector(".settings-dialog[open]")) return;
      if (attempts > 0 && surfaceRef.current?.contains(document.activeElement)) return;
      const remembered = focusMemory.current.get(pageKey);
      const first = surfaceRef.current?.querySelector<HTMLElement>("[data-settings-row], .settings-panel button:not(:disabled)");
      const target = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>("[data-settings-row]") ?? [])
        .find(row => row.getAttribute("aria-label") === remembered) ?? first;
      target?.focus({ preventScroll: true });
      // The route entrance can temporarily hide this Activity. A fast release
      // chunk must not lose initial remote focus before that entrance reveals it.
      if (document.activeElement !== target && ++attempts < 120) frame = requestAnimationFrame(focusWhenVisible);
    };
    frame = requestAnimationFrame(focusWhenVisible);
    return () => cancelAnimationFrame(frame);
  }, [pageKey]);

  function backLevel() {
    if (profileEditView) {
      if (profileEditorExitRef.current) profileEditorExitRef.current();
      else closeProfileEditor(true);
      return;
    }
    if (activeTab === "account" && accountView !== "overview") {
      setAccountView(accountView === "manage-profiles" ? "profiles" : ["profiles", "integrations"].includes(accountView) ? "overview" : "integrations");
    } else if (activeTab === "design" && designView !== "overview") setDesignView("overview");
    else selectTab(null);
  }

  function closeProfileEditor(discard = false) {
    if (discard && profileEditView === "name") setProfileName(activeProfile?.name ?? "");
    setProfilePin("");
    setProfileError("");
    setProfileEditView(null);
  }

  function openProfileEditor(view: "name" | "pin") {
    profileEditReturnLabel.current = view === "name" ? "Nombre" : "PIN opcional";
    setProfileError("");
    if (view === "name") setProfileName(activeProfile?.name ?? "");
    else setProfilePin("");
    setProfileEditView(view);
  }

  useLayoutEffect(() => {
    if (profileEditView || !profileEditReturnLabel.current) return;
    const label = profileEditReturnLabel.current;
    profileEditReturnLabel.current = null;
    requestAnimationFrame(() => surfaceRef.current?.querySelector<HTMLElement>(`[data-settings-row][aria-label="${label}"]`)?.focus({ preventScroll: true }));
  }, [profileEditView]);

  useEffect(() => {
    const back = (event: Event) => {
      if (!activeTab || document.querySelector("dialog[open], [data-settings-confirmation]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      backLevel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Backspace") return;
      if (profileEditView === "name" && event.key === "Backspace") return;
      if (event.key === "Backspace" && (event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable='true']")) return;
      back(event);
    };
    window.addEventListener("aetherio-input:back", back, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("aetherio-input:back", back, true); window.removeEventListener("keydown", key, true); };
  });

  useEffect(() => {
    setKeys(getApiKeys());
    setMdbList(getMdbListSettings());
    setPlayback(getPlaybackPreferences());
    setSpatialPosters(getSpatialPosterSettings());
  }, []);

  useEffect(() => {
    setLocalHomePreferences(homePreferences);
  }, [homePreferences]);

  useEffect(() => {
    const tab = getInitialTab(location.search);
    setActiveTab(tab);
    setFocusedCategory(tab ?? "account");
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

  function selectTab(tab: SettingsTab | null) {
    setSaved(EMPTY_SAVED_SECTIONS);
    setActiveTab(tab);
    if (tab) setFocusedCategory(tab);
    setAccountView("overview");
    setDesignView("overview");
    // En Big Picture los ajustes viven en /big-picture/settings: conservar
    // el prefijo para no salir del modo inmersivo.
    const base = isBigPictureLocation() ? "/big-picture/settings" : "/settings";
    navigate(tab ? `${base}?tab=${tab}` : base, { replace: true });
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

  function updateDownloadsEnabled(enabled: boolean) {
    saveDownloadsEnabled(enabled);
    setSaved(current => ({ ...current, playback: true }));
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

  function updateSpatialPosters(patch: Partial<SpatialPosterSettings>) {
    setSpatialPosters(current => {
      const next = { ...current, ...patch };
      saveSpatialPosterSettings(next);
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
      if (!activeProfile) return;
      const updated = await updateLocalProfile(activeProfile.id, {
        name: profileName,
        avatarDataUrl: dataUrl,
      });
      if (updated) {
        setActiveProfileState(updated);
        setProfileAvatar(updated.avatarDataUrl);
        setProfiles(getLocalProfiles());
      }
      setProfileError("");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "No se pudo leer la imagen.");
    }
  }

  async function saveProfileName() {
    if (!activeProfile) return;
    const updated = await updateLocalProfile(activeProfile.id, {
      name: profileName,
      avatarDataUrl: activeProfile.avatarDataUrl,
    });
    if (updated) {
      setActiveProfileState(updated);
      setProfileName(updated.name);
      setProfiles(getLocalProfiles());
    }
    setProfileError("");
  }

  async function confirmProfileName() {
    if (!profileName.trim()) return;
    await saveProfileName();
  }

  async function saveProfilePin() {
    if (!activeProfile || !profilePin) return false;
    const pinIssue = pinLengthError(profilePin);
    if (pinIssue) {
      setProfileError(pinIssue);
      return false;
    }
    const updated = await updateLocalProfile(activeProfile.id, {
      name: activeProfile.name,
      pin: profilePin,
      avatarDataUrl: activeProfile.avatarDataUrl,
    });
    setProfileError("");
    if (updated) setActiveProfileState(updated);
    setProfilePin("");
    setProfiles(getLocalProfiles());
    return Boolean(updated);
  }

  async function confirmProfilePin() {
    return saveProfilePin();
  }

  function removeProfilePin() {
    if (!activeProfile || !removeLocalProfilePin(activeProfile.id)) return;
    setProfilePin("");
    setActiveProfileState(getActiveProfile());
    setProfiles(getLocalProfiles());
    setProfileError("");
  }

  async function switchProfile(profile: LocalProfile) {
    if (profile.id === activeProfile?.id) return;
    if (profile.pin) {
      setSwitchTarget(profile);
      setSwitchPin("");
      setSwitchError("");
      return;
    }
    setActiveProfile(profile.id);
    window.location.reload();
  }

  async function confirmProfileSwitch() {
    if (!switchTarget?.pin || switchBusy) return;
    setSwitchBusy(true);
    try {
      if (!(await verifyPin(switchPin, switchTarget.pin))) { setSwitchError("PIN incorrecto. Inténtalo de nuevo."); return; }
      setActiveProfile(switchTarget.id);
      window.location.reload();
    } finally { setSwitchBusy(false); }
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
      setProfileError("");
    }
    setProfiles(remaining);
  }

  return (
    <SettingsHelpProvider>
    {profileEditView ? (
      <ProfileFieldEditor
        key={profileEditView}
        view={profileEditView}
        name={profileName}
        pin={profilePin}
        nameMode={nameKeyboardMode}
        error={profileError}
        onNameChange={setProfileName}
        onNameModeChange={setNameKeyboardMode}
        onPinChange={value => setProfilePin(value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
        onSaveName={confirmProfileName}
        onSavePin={confirmProfilePin}
        onCancel={() => closeProfileEditor(true)}
        onSaved={() => closeProfileEditor()}
        exitRef={profileEditorExitRef}
      />
    ) : null}
    <main ref={surfaceRef} inert={profileEditView !== null} aria-hidden={profileEditView ? true : undefined} className={`settings-surface${tv ? " settings-surface--tv" : ""}`} data-settings-surface data-settings-nested={activeTab ? "true" : "false"} data-bp-settings={tv ? "" : undefined}
      onFocusCapture={event => {
        const row = event.target as HTMLElement;
        const label = row.getAttribute("aria-label");
        if (row.matches("[data-settings-row]") && label) focusMemory.current.set(pageKey, label);
      }}>
      <header className="settings-surface__header">
        {activeTab && !tv ? <button type="button" className="settings-surface__back liquid-glass-pill rounded-full" aria-label="Volver" onClick={backLevel}><ArrowLeft size={20} /><span>Volver</span></button> : null}
      </header>
      <div className="settings-surface__layout">
          <aside className="settings-surface__identity">
          {identityProfileAvatar
            ? <img className="settings-surface__image settings-surface__profile-image" src={identityProfileAvatar} alt="Foto de perfil" />
            : <SettingsCategoryIcon category={activeTab ?? focusedCategory} />}
          <p className="settings-surface__description" data-settings-description aria-live="polite"><SettingsHelpDescription /></p>
        </aside>
        <div className="settings-surface__content">
          {!activeTab ? <nav className="settings-surface__categories" aria-label="Categorías de ajustes">{SIDEBAR_ITEMS.map(item => <SettingsRow key={item.id} title={item.label} description={item.description} onFocus={() => setFocusedCategory(item.id)} onClick={() => selectTab(item.id)} />)}</nav> : null}
          {activeTab === "account" ? (
            <AccountPanel
              view={accountView}
              profiles={profiles}
              activeProfile={activeProfile}
              onProfileFocus={setFocusedProfileId}
              onEditProfileName={() => openProfileEditor("name")}
              onEditProfilePin={() => openProfileEditor("pin")}
              profileName={profileName}
              profileError={profileError}
              saved={saved}
              keys={keys}
              mdbList={mdbList}
              onViewChange={setAccountView}
              onChooseProfileImage={chooseProfileImage}
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
              spatialPosters={spatialPosters}
              onSpatialPostersChange={updateSpatialPosters}
            />
          ) : null}

          {activeTab === "addons" ? (
            <AddonsPanel
              installedCount={addons.length}
              enabledCount={addons.filter(addon => addon.enabled).length}
              onOpenAddons={() => navigate(isBigPictureLocation() ? "/big-picture/addons" : "/addons")}
            />
          ) : null}

          {import.meta.env.DEV && activeTab === "sources" ? <PanelScaffold title="Fuentes"><PopupSetting title="Gestionar fuentes" description="Administra repositorios, proveedores y servicios de contenido en esta versión de desarrollo."><SourcesPanel /></PopupSetting></PanelScaffold> : null}

          {activeTab === "playback" ? (
            <PlaybackPanel
              playback={playback}
              onPlaybackChange={updatePlayback}
              downloadsEnabled={downloadsEnabled}
              onDownloadsEnabledChange={updateDownloadsEnabled}
              saved={saved.playback}
            />
          ) : null}

          {activeTab === "about" ? <AboutPanel /> : null}
        </div>
      </div>
    </main>
    {switchTarget ? <SettingsDialog title={`Entrar en ${switchTarget.name}`} description="Introduce el PIN de este perfil." onClose={() => setSwitchTarget(null)}>
      <PinPad value={switchPin} onChange={value => { setSwitchPin(value.replace(/\D/g, "").slice(0, PIN_LENGTH)); setSwitchError(""); }} error={switchError} title="PIN del perfil" />
      <ActionButton onClick={() => void confirmProfileSwitch()} disabled={switchBusy || switchPin.length !== PIN_LENGTH}>{switchBusy ? "Verificando…" : "Entrar"}</ActionButton>
    </SettingsDialog> : null}
    </SettingsHelpProvider>
  );
}

function AccountPanel({
  view,
  profiles,
  activeProfile,
  onProfileFocus,
  onEditProfileName,
  onEditProfilePin,
  profileName,
  profileError,
  saved,
  keys,
  mdbList,
  onViewChange,
  onChooseProfileImage,
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
  onProfileFocus: (profileId: string) => void;
  onEditProfileName: () => void;
  onEditProfilePin: () => void;
  profileName: string;
  profileError: string;
  saved: SavedSections;
  keys: ApiKeys;
  mdbList: MdbListSettings;
  onViewChange: (view: AccountView) => void;
  onChooseProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
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
  const [gdriveSync, setGdriveSync] = useState(() => getGoogleDriveAuthSnapshot());
  const [gdriveStatus, setGdriveStatus] = useState("");
  const [gdriveError, setGdriveError] = useState("");
  const [gdriveBusy, setGdriveBusy] = useState(false);

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
    const refresh = () => setGdriveSync(getGoogleDriveAuthSnapshot());
    refresh();
    window.addEventListener(GDRIVE_AUTH_CHANGED_EVENT, refresh);
    window.addEventListener(GDRIVE_SYNC_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(GDRIVE_AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener(GDRIVE_SYNC_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  async function startGoogleDriveConnection() {
    setGdriveBusy(true);
    setGdriveError("");
    setGdriveStatus("");
    try {
      await startGoogleDriveAuthorization();
      setGdriveSync(getGoogleDriveAuthSnapshot());
      setGdriveStatus("Google Drive conectado. Iniciando la sincronización automática.");
    } catch (error) {
      setGdriveError(describeUnknownError(error, "No se pudo iniciar la conexión con Google Drive."));
    } finally {
      setGdriveBusy(false);
    }
  }

  function disconnectGoogleDriveAccount() {
    setGdriveBusy(true);
    setGdriveError("");
    setGdriveStatus("");
    try {
      disconnectGoogleDrive();
      setGdriveSync(getGoogleDriveAuthSnapshot());
      setGdriveStatus("Google Drive desconectado. El respaldo en Drive se conserva.");
    } catch (error) {
      setGdriveError(describeUnknownError(error, "No se pudo desconectar Google Drive."));
    } finally {
      setGdriveBusy(false);
    }
  }

  async function runManualGoogleDriveSync() {
    setGdriveBusy(true);
    setGdriveError("");
    setGdriveStatus("");
    try {
      await syncGoogleDriveNow();
      const fresh = getGoogleDriveAuthSnapshot();
      setGdriveSync(fresh);
      setGdriveError(fresh.lastError ?? "");
      setGdriveStatus(fresh.lastError ? "Sincronización con errores." : "Sincronización completada.");
    } catch (error) {
      setGdriveError(describeUnknownError(error, "No se pudo sincronizar con Google Drive."));
    } finally {
      setGdriveBusy(false);
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
          onProfileFocus={onProfileFocus}
          onEditProfileName={onEditProfileName}
          onEditProfilePin={onEditProfilePin}
          profileName={profileName}
          profileError={profileError}
          onChooseProfileImage={onChooseProfileImage}
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
          <NavRow title="Biblioteca y sincronización" description="Sincroniza AniList o Google Drive, e importa o reimporta tus datos de Trakt." onClick={() => onViewChange("library-sync")} />
          <NavRow title="Discord Rich Presence" description="Muestra en Discord lo que estás viendo en Aetherio." onClick={() => onViewChange("discord")} />
        </PillBlock>
      </PanelScaffold>
    );
  }

  if (view === "library-sync") {
    return (
      <PanelScaffold title="Biblioteca y sincronización" onBack={() => onViewChange("integrations")}>
        <LibrarySyncSettings renderIntegration={SettingsIntegration} />
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

  if (view === "gdrive") {
    return (
      <PanelScaffold title="Google Drive" onBack={() => onViewChange("integrations")}>
        <div className="grid gap-5">
          <PillBlock>
            <PillRow
              title={gdriveSync.connected ? "Cuenta de Google conectada" : "Respaldo en Google Drive"}
              description={
                gdriveSync.connected
                  ? gdriveSync.syncing
                    ? "Sincronizando con tu Google Drive..."
                    : gdriveSync.lastError
                      ? `Último intento con error: ${gdriveSync.lastError}`
                      : gdriveSync.lastSyncedAt
                        ? `Última sincronización: ${new Date(gdriveSync.lastSyncedAt).toLocaleTimeString()}. La sincronización es automática.`
                        : "Sincronización automática activa: sube los cambios con un pequeño retardo y baja el respaldo al arrancar o al cambiar de perfil."
                  : gdriveSync.authorizationPending
                    ? "Termina la autorización en Google o vuelve a abrir la página de conexión."
                    : gdriveSync.credentialsConfigured
                      ? "Conecta tu cuenta de Google para respaldar continuar viendo, el historial visto y la biblioteca en tu propio Drive, en la carpeta privada de Aetherio (appDataFolder), invisible en tu Drive normal."
                      : "Google Drive no esta configurado en esta version de Aetherio."
              }
            >
              {gdriveSync.connected ? (
                <ActionButton onClick={disconnectGoogleDriveAccount} icon={<Unlink size={15} />} disabled={gdriveBusy}>Desconectar</ActionButton>
              ) : (
                <ActionButton onClick={startGoogleDriveConnection} icon={<LogIn size={15} />} disabled={gdriveBusy || !gdriveSync.credentialsConfigured}>
                  {gdriveSync.authorizationPending ? "Reabrir Google" : "Conectar Google Drive"}
                </ActionButton>
              )}
            </PillRow>
          </PillBlock>

          <div className="flex flex-wrap items-center gap-3">
            <ActionButton onClick={runManualGoogleDriveSync} icon={<RefreshCw size={15} />} disabled={gdriveBusy || !gdriveSync.connected}>Sincronizar ahora</ActionButton>
          </div>
          {gdriveStatus ? <p className="text-sm text-white/56">{gdriveStatus}</p> : null}
          {gdriveError ? <p className="text-sm font-semibold text-red-300">{gdriveError}</p> : null}
          <p className="text-xs text-white/36">
            Los archivos se guardan en la carpeta privada de la app dentro de tu Drive (no cuentan como archivos visibles ni los puedes borrar a mano).
            Cada perfil local tiene su propio respaldo; si dos dispositivos cambian lo mismo, gana la edición más reciente.
          </p>
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
              onSave={onSaveIntegrations}
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
              aria-label={details.label}
              type="password"
              value={keys[details.key]}
              onChange={event => onKeyChange(details.key, event.target.value)}
              placeholder={details.placeholder}
              className="w-full rounded-full border border-white/18 bg-white px-4 py-2.5 text-sm text-black outline-none gsap-transition placeholder:text-black/45 focus:border-white/34"
            />
          </PillRow>
        </PillBlock>
<div className="mt-5 flex items-center gap-3">
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
            onSave={onSaveIntegrations}
            description="Proporciona timestamps exactos de créditos (outros) para películas y series. Aetherio los usa para mostrar Up Next justo cuando empiezan los créditos; si no hay dato, se usa el umbral por porcentaje."
          >
            <input
              aria-label="Token de TheIntroDB"
              type="password"
              value={keys.introDbApiKey}
              onChange={event => onKeyChange("introDbApiKey", event.target.value)}
              placeholder="Pega aquí tu token de theintrodb.org"
              className="w-full rounded-full border border-white/18 bg-white px-4 py-2.5 text-sm text-black outline-none gsap-transition placeholder:text-black/45 focus:border-white/34"
            />
          </PillRow>
        </PillBlock>
        <div className="mt-5 flex items-center gap-3">
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
        <NavRow title="Integraciones" description="Configurar servicios, bibliotecas y sincronización." onClick={() => onViewChange("integrations")} />
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
            onSave={onSaveApiKey}
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
              aria-label="API Key de MDBList"
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
          {saved ? <span className="text-sm text-white/54">Guardado.</span> : null}
        </div>

      </div>
    </PanelScaffold>
  );
}

function ManageProfiles({
  profiles,
  activeProfile,
  onProfileFocus,
  onEditProfileName,
  onEditProfilePin,
  profileName,
  profileError,
  onChooseProfileImage,
  onRemoveProfilePin,
  onSwitchProfile,
  onDeleteProfile,
}: {
  profiles: LocalProfile[];
  activeProfile: LocalProfile | null;
  onProfileFocus: (profileId: string) => void;
  onEditProfileName: () => void;
  onEditProfilePin: () => void;
  profileName: string;
  profileError: string;
  onChooseProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveProfilePin: () => void;
  onSwitchProfile: (profile: LocalProfile) => void;
  onDeleteProfile: (profile: LocalProfile) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<LocalProfile | null>(null);
  const [deletePin, setDeletePin] = useState("");
  const [deletePinError, setDeletePinError] = useState("");
  const [deletePinVerifying, setDeletePinVerifying] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (confirmDelete) deletePinError && setDeletePinError("");
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
        {activeProfile ? (
          <div className="grid gap-4 p-5">
              <SettingsRow title="Nombre" description="Cambia el nombre que aparece en este perfil." value={profileName} onClick={onEditProfileName} />
              <SettingsRow title="PIN opcional" description="Define un PIN de cuatro dígitos para proteger este perfil." value={activeProfile.pin ? "Configurado" : "Sin PIN"} onClick={onEditProfilePin} />
              <SettingsRow title="Cambiar foto" description="Selecciona una imagen para este perfil." value="Elegir" onClick={() => avatarInputRef.current?.click()} />
              <input ref={avatarInputRef} type="file" accept="image/*" aria-label="Archivo de foto de perfil" onChange={onChooseProfileImage} className="hidden" />
              <div className="flex items-center gap-3">
                {activeProfile.pin ? (
                  <button
                    type="button"
                    onClick={onRemoveProfilePin}
                    className="rounded-full border border-white/12 px-4 py-2 text-xs font-black text-white/58 gsap-transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-200"
                  >
                    Quitar PIN
                  </button>
                ) : null}
              </div>
          </div>
        ) : null}
      </PillBlock>

      <PillBlock title="Perfiles en este equipo">
        {profiles.map(profile => {
          const isActive = profile.id === activeProfile?.id;
          const isOnlyProfile = profiles.length <= 1;
          return (
            <PillRow key={profile.id} title={profile.name} description={profile.pin ? "PIN activo" : "Sin PIN"} leading={<ProfileAvatar profile={profile} className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full" />} onFocus={() => onProfileFocus(profile.id)}>
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
                    aria-label={`Eliminar perfil ${profile.name}`}
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
        <SettingsDialog title="Eliminar perfil" description="Esta acción no se puede deshacer." onClose={() => { setConfirmDelete(null); setDeletePin(""); setDeletePinError(""); }}>
            <p className="mb-4 text-sm leading-6 text-white/60">
              ¿Estás seguro de eliminar el perfil <span className="font-bold text-white">{confirmDelete.name}</span>? Todos los datos
              locales asociados se borrarán permanentemente.
            </p>
            {confirmDelete.pin ? (
              <div className="mb-4">
                <PinPad
                  value={deletePin}
                  onChange={value => { setDeletePin(value.replace(/\D/g, "")); setDeletePinError(""); }}
                  title="PIN del perfil"
                  subtitle="Confírmalo para eliminar el perfil."
                  error={deletePinError}
                />
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
        </SettingsDialog>
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
  spatialPosters,
  onSpatialPostersChange,
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
  spatialPosters: SpatialPosterSettings;
  onSpatialPostersChange: (patch: Partial<SpatialPosterSettings>) => void;
}) {
  if (view === "home-screen") {
    return (
      <PanelScaffold title="Pantalla de inicio" onBack={() => onViewChange("overview")}>
        <div className="grid gap-5">
          <section>
            <ContentOrientationControl
              value={preferences.contentOrientation}
              onChange={contentOrientation => onPreferencesChange({ contentOrientation })}
            />
          </section>

          <PillBlock title="Plataformas de streaming">
            <ToggleRow
              title="Reproducir intros de plataformas"
              description="Muestra la intro cada vez que entras a una página de plataforma."
              checked={preferences.playStreamingPlatformIntros}
              onChange={checked => onPreferencesChange({ playStreamingPlatformIntros: checked })}
            />
          </PillBlock>

          {preferences.contentOrientation === "both" ? (
            <section>
              <BothPreferenceControl
                value={preferences.bothPreference}
                onChange={bothPreference => onPreferencesChange({ bothPreference })}
              />
            </section>
          ) : null}

          <PillBlock title="SPATIALPOSTERS">
            <ToggleRow
              title="Usar SpatialPosters"
              description="Pósters con etiquetas de género, año, rating, ranking y logo de distribuidora. Si la instancia no está corriendo, se usan los pósters originales de TMDB."
              checked={spatialPosters.enabled}
              onChange={checked => onSpatialPostersChange({ enabled: checked })}
            />
          </PillBlock>

          <section>
            <PopupSetting title="Orden y visibilidad de catálogos" description="Activa los catálogos que quieres ver y usa las flechas para decidir su orden en Inicio." value={`${visibleCatalogRows.length} activos`}>
            <div className="settings-catalogs">
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
                          <ToggleSwitch
                            checked={!hidden}
                            onChange={() => onToggleCatalog(row)}
                            label={`Mostrar ${cleanCatalogTitle(row.name)}`}
                          />
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
            <p className="settings-static">{visibleCatalogRows.length} catálogos activos.</p>
            </PopupSetting>
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

  return <ChoiceSetting title="Contenido principal" value={value} options={options} onChange={next => onChange(next as ContentOrientation)} />;
}

function BothPreferenceControl({ value, onChange }: { value: BothContentPreference; onChange: (value: BothContentPreference) => void }) {
  const options: Array<{ value: BothContentPreference; label: string }> = [
    { value: "anime", label: "Anime" },
    { value: "movies-series", label: "Series y películas" },
  ];

  return <ChoiceSetting title="Preferencia de contenido" value={value} options={options} onChange={next => onChange(next as BothContentPreference)} />;
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
  downloadsEnabled,
  onDownloadsEnabledChange,
  saved,
}: {
  playback: PlaybackPreferences;
  onPlaybackChange: <Value extends PlaybackPreferences[keyof PlaybackPreferences]>(name: keyof PlaybackPreferences, value: Value) => void;
  downloadsEnabled: boolean;
  onDownloadsEnabledChange: (enabled: boolean) => void;
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

        <PillBlock title="DESCARGAS SIN CONEXIÓN">
          <ToggleRow
            title="Permitir descargas"
            description="Activa los botones de descarga y el acceso a tus archivos sin conexión en esta app."
            checked={downloadsEnabled}
            onChange={onDownloadsEnabledChange}
          />
        </PillBlock>

        <PillBlock title="SUBTÍTULOS Y AUDIO">
          <SelectRow title="Idioma de audio preferido" value={playback.firstAudioLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("firstAudioLanguage", value)} />
          <SelectRow title="Idioma de audio secundario" value={playback.secondAudioLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("secondAudioLanguage", value)} />
          <SelectRow title="Idioma de subtítulos preferido" value={playback.preferredSubtitleLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("preferredSubtitleLanguage", value)} />
          <SelectRow title="Idioma de subtítulos secundario" value={playback.secondSubtitleLanguage} options={LANGUAGE_OPTIONS} onChange={value => onPlaybackChange("secondSubtitleLanguage", value)} />
          <SelectRow
            title="Sincronización automática de subtítulos"
            value={playback.autoSubtitleSync}
            options={[
              { value: "on", label: "Todos los títulos" },
              { value: "learned", label: "Solo títulos ya sincronizados" },
              { value: "off", label: "Nunca" },
            ]}
            onChange={value => onPlaybackChange("autoSubtitleSync", value as PlaybackPreferences["autoSubtitleSync"])}
          />
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
          <ToggleRow
            title="Probar otra fuente automáticamente"
            description="Tras un fallo, prueba hasta dos fuentes alternativas. Puede que ninguna funcione; esta opción solo cambia los reintentos automáticos."
            checked={playback.automaticSourceRecovery}
            onChange={checked => onPlaybackChange("automaticSourceRecovery", checked)}
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
              description="Pasar automáticamente al siguiente episodio cuando queden estos minutos (0-3.5 min)."
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
              description="Pasar automáticamente al siguiente episodio cuando la reproducción alcance este porcentaje. Si hay outro detectado y termina pegado al final, se dispara al empezar los créditos."
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
              description="Mostrar la recomendación cuando la película alcance este porcentaje (80-100%). Si hay créditos detectados, se dispara al empezar los créditos."
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
  const pendingUpdateRef = useRef<{ version: string; downloadAndInstall: () => Promise<void>; close?: () => Promise<void> } | null>(null);

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
    setUpdateMessage("Buscando actualizaciones…");
    setUpdateReady(false);
    const previousUpdate = pendingUpdateRef.current;
    if (previousUpdate?.close) void previousUpdate.close().catch(() => undefined);
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
        <PopupSetting title="Aetherio" value={`Versión ${appVersion}`} hideHeader>
          <div className="settings-version-brand">
            <img src={aetherioLogo} alt="Aetherio" />
            <span>{appVersion}</span>
          </div>
          <p className="settings-version-credit">Creado por trkll</p>
        </PopupSetting>
      </PillBlock>

      <PillBlock title="Actualizaciones">
        <PopupSetting title="Actualizaciones de Aetherio" description="Comprueba si hay una nueva versión y, si está disponible, descárgala e instálala." onOpen={() => void handleCheckUpdate()}>
        <div className="settings-update-status" aria-live="polite">
          {checkingUpdate ? <span className="settings-update-status__checking"><AppleSpinner size={16} /> Buscando actualizaciones…</span> : null}
          {updateReady && !installingUpdate ? (
            <button
              type="button"
              onClick={() => void handleInstallUpdate()}
              className="settings-update-status__install"
            >
              Instalar actualización
            </button>
          ) : null}
          {installingUpdate ? (
            <p className="settings-update-status__message">Instalando… No cierres la app.</p>
          ) : null}
          {!checkingUpdate && updateMessage ? (
            <p className="settings-update-status__message">{updateMessage}</p>
          ) : null}
        </div>
        </PopupSetting>
      </PillBlock>
    </PanelScaffold>
  );
}

function PanelScaffold({ title, children }: { title: string; children: ReactNode; onBack?: () => void }) {
  return <section className="settings-panel" aria-label={title}>{children}</section>;
}

function PillBlock({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title ? <SectionLabel>{title}</SectionLabel> : null}
      <div className="settings-block">
        {children}
      </div>
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="settings-section-label">{children}</h3>;
}

function NavRow({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return <SettingsRow title={title} description={description} onClick={onClick} />;
}

function PillRow({
  title,
  titleAction,
  description,
  leading,
  children,
  onSave,
  onFocus,
}: {
  title: ReactNode;
  titleAction?: ReactNode;
  description?: string;
  leading?: ReactNode;
  children?: ReactNode;
  onSave?: () => void;
  onFocus?: () => void;
}) {
  const label = typeof title === "string" ? title : "Información";
  return <PopupSetting title={label} description={description} leading={leading} value={controlSummary(children)} onSave={onSave} onFocus={onFocus}>
    {titleAction ? <div className="mb-4">{titleAction}</div> : null}
    {children ?? <p className="settings-static">{description ?? title}</p>}
  </PopupSetting>;
}

function SettingsIntegration({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <PopupSetting title={title} description={description}>{children}</PopupSetting>;
}

function controlSummary(children: ReactNode): string | undefined {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ value?: unknown; type?: string; children?: ReactNode }>(child)) continue;
    if (child.type === "input") return child.props.type === "password" ? (child.props.value ? "Configurado" : "Sin configurar") : String(child.props.value ?? "");
    if (child.type === ActionButton) return typeof child.props.children === "string" ? child.props.children : undefined;
  }
  return undefined;
}

function ToggleRow({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <SettingsRow title={title} description={description} value={checked ? "Activado" : "Desactivado"} pressed={checked} onClick={() => onChange(!checked)} />;
}

function SelectRow({ title, description, value, options, onChange }: { title: string; description?: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <ChoiceSetting title={title} description={description} value={value} options={options} onChange={onChange} />;
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
  const [sliderOpen, setSliderOpen] = useState(false);
  const sliderRef = useRef<HTMLInputElement>(null);
  const quickToValueRef = useRef<((value: number) => void) | null>(null);
  const displayValue = step == null || step >= 1 ? String(Math.round(value)) : String(Number(value.toFixed(1)));

  useEffect(() => {
    const slider = sliderRef.current;
    if (!slider) return;
    const quickToValue = gsap.quickTo(slider, "value", {
      duration: 0.12,
      ease: "none",
      onUpdate: () => updateRangeInput(slider, Number(slider.value)),
    });
    quickToValueRef.current = quickToValue;
    const onRangeTarget = (event: Event) => {
      const detail = (event as CustomEvent<{ value: number; animate?: boolean }>).detail;
      if (!detail || typeof detail.value !== "number" || !Number.isFinite(detail.value)) return;
      if (detail.animate === false) {
        gsap.killTweensOf(slider);
        updateRangeInput(slider, detail.value);
      } else quickToValue(detail.value);
    };
    slider.addEventListener("aetherio-range-input-target", onRangeTarget);
    return () => {
      slider.removeEventListener("aetherio-range-input-target", onRangeTarget);
      gsap.killTweensOf(slider);
      quickToValueRef.current = null;
    };
  }, [sliderOpen]);

  const changeBy = (amount: number, input?: HTMLInputElement) => {
    const next = Math.min(max, Math.max(min, Number((value + amount).toFixed(3))));
    if (input) {
      input.dataset.targetValue = String(next);
      input.dataset.preciseTargetValue = String(next);
      requestRangeInputValue(input, next);
    }
    if (!input) onChange(next);
  };
  return (
    <PopupSetting title={title} description={description} value={`${displayValue}${suffix}`} hideDialogDescription onOpen={() => setSliderOpen(true)} onClose={() => setSliderOpen(false)}>
      <output className="settings-range-value">{displayValue}{suffix}</output>
      <input
        ref={sliderRef}
        className="settings-range-slider"
        data-settings-range={title}
        data-target-value={value}
        data-range-step={step ?? 1}
        aria-label={title}
        type="range"
        min={min}
        max={max}
        step="any"
        value={value}
        onChange={event => {
          const nextValue = Number(event.target.value);
          event.currentTarget.dataset.targetValue = String(nextValue);
          event.currentTarget.dataset.preciseTargetValue = String(nextValue);
          onChange(nextValue);
        }}
        onPointerUp={event => {
          const input = event.currentTarget;
          const next = getSteppedRangeValue(
            Number(input.dataset.preciseTargetValue ?? input.value),
            min,
            max,
            step ?? 1,
            0,
          );
          input.dataset.targetValue = String(next);
          input.dataset.preciseTargetValue = String(next);
          requestRangeInputValue(input, next, true);
        }}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          changeBy(event.key === "ArrowRight" ? (step ?? 1) : -(step ?? 1), event.currentTarget);
        }}
      />
    </PopupSetting>
  );
}

function StaticText({ children }: { children: ReactNode }) {
  return <div className="settings-static">{children}</div>;
}

function ProfileFieldEditor({ view, name, pin, nameMode, error, onNameChange, onNameModeChange, onPinChange, onSaveName, onSavePin, onCancel, onSaved, exitRef }: {
  view: "name" | "pin";
  name: string;
  pin: string;
  nameMode: KeyboardMode;
  error: string;
  onNameChange: (value: string) => void;
  onNameModeChange: (mode: KeyboardMode) => void;
  onPinChange: (value: string) => void;
  onSaveName: () => Promise<void>;
  onSavePin: () => Promise<boolean>;
  onCancel: () => void;
  onSaved: () => void;
  exitRef: { current: (() => void) | null };
}) {
  const [exiting, setExiting] = useState(false);
  const exitingRef = useRef(false);
  const finishTimer = useRef<number | null>(null);

  const beginExit = (finish: () => void) => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    finishTimer.current = window.setTimeout(finish, 220);
  };

  const cancelWithFade = () => beginExit(onCancel);
  const saveNameWithFade = async () => {
    if (exitingRef.current) return;
    const startedAt = performance.now();
    exitingRef.current = true;
    setExiting(true);
    try {
      await onSaveName();
      finishTimer.current = window.setTimeout(onSaved, Math.max(0, 220 - (performance.now() - startedAt)));
    } catch {
      exitingRef.current = false;
      setExiting(false);
    }
  };
  const savePinWithFade = async () => {
    if (exitingRef.current) return;
    const startedAt = performance.now();
    exitingRef.current = true;
    setExiting(true);
    if (await onSavePin()) {
      finishTimer.current = window.setTimeout(onSaved, Math.max(0, 220 - (performance.now() - startedAt)));
    } else {
      exitingRef.current = false;
      setExiting(false);
    }
  };

  const cancelWithFadeRef = useRef(cancelWithFade);
  cancelWithFadeRef.current = cancelWithFade;

  useLayoutEffect(() => {
    exitRef.current = () => cancelWithFadeRef.current();
    return () => {
      exitRef.current = null;
      if (finishTimer.current !== null) window.clearTimeout(finishTimer.current);
    };
  }, [exitRef]);

  return (
    <main className="qs-profile profile-field-editor" data-profile-field-editor={view} data-transitioning={exiting ? "out" : "in"}>
      <button type="button" className="profile-field-editor__back" onClick={cancelWithFade}>Volver</button>
      <div className="qs-profile__stage">
        {view === "name" ? (
          <div className="qs-name">
            <NameKeyboard value={name} onChange={onNameChange} mode={nameMode} onModeChange={onNameModeChange} maxLength={32} />
            <div className="qs-name__form">
              <h1 className="qs-name__title">Elige un nombre</h1>
              <p className="qs-name__field" aria-live="polite">{name}</p>
              <button type="button" className="qs-name__cta" disabled={!name.trim() || exiting} onClick={saveNameWithFade}>
                Listo <ChevronRight size={20} strokeWidth={2.6} />
              </button>
              <p className="qs-name__hint">El nombre aparece en tu perfil y en los puntos donde tengas sesión iniciada.</p>
            </div>
          </div>
        ) : (
          <div className="qs-pin">
            <PinPad
              value={pin}
              onChange={onPinChange}
              onComplete={() => void savePinWithFade()}
              onCancel={cancelWithFade}
              title="Elige un PIN"
              subtitle="Cuatro dígitos para proteger este perfil en este equipo."
            />
            <button type="button" className="qs-pin__skip" onClick={cancelWithFade}>Cancelar</button>
          </div>
        )}
      </div>
      {error ? <p className="qs-profile__error" role="alert">{error}</p> : null}
    </main>
  );
}

function ActionButton({ children, icon, disabled, onClick }: { children: ReactNode; icon?: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "settings-action",
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

function getInitialTab(search: string): SettingsTab | null {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "account" || tab === "profile" || tab === "services" || tab === "integrations" || tab === "gdrive" || tab === "mdblist") return "account";
  if (tab === "sources") return import.meta.env.DEV ? "sources" : null;
  if (tab === "design" || tab === "addons" || tab === "playback" || tab === "about") return tab;
  return null;
}

function getInitialAccountView(search: string): AccountView {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "services" || tab === "integrations") return "integrations";
  if (tab === "gdrive") return "gdrive";
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
