import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Captions, ImagePlus, KeyRound, LogIn, PlayCircle, Plus, Save, UserRound, Volume2 } from "lucide-react";
import PageContainer from "../../components/layout/PageContainer";
import ProfileAvatar from "../../components/profile/ProfileAvatar";
import { getApiKeys, saveApiKeys, type ApiKeys } from "../../config/apiKeys";
import {
  LANGUAGE_OPTIONS,
  getPlaybackPreferences,
  savePlaybackPreferences,
  type AddonSubtitleLoadMode,
  type PlaybackPreferences,
  type SourceSelectionMode,
} from "../../config/playbackPreferences";
import {
  createLocalProfile,
  getActiveProfile,
  getLocalProfiles,
  LOCAL_PROFILES_CHANGED_EVENT,
  readImageFileAsDataUrl,
  setActiveProfile,
  updateLocalProfile,
  type LocalProfile,
} from "../../utils/localProfiles";

type MainTab = "profile" | "services" | "playback";
type PlaybackTab = "audio" | "subtitles";

export default function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKeys>(() => getApiKeys());
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => getPlaybackPreferences());
  const [activeMainTab, setActiveMainTab] = useState<MainTab>(() => getInitialMainTab(location.search));
  const [activePlaybackTab, setActivePlaybackTab] = useState<PlaybackTab>("audio");
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
    setPlayback(getPlaybackPreferences());
  }, []);

  useEffect(() => {
    setActiveMainTab(getInitialMainTab(location.search));
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

  function updateKey(name: keyof ApiKeys, value: string) {
    setSaved(false);
    setKeys(current => ({ ...current, [name]: value }));
  }

  function updatePlayback<Value extends PlaybackPreferences[keyof PlaybackPreferences]>(name: keyof PlaybackPreferences, value: Value) {
    setSaved(false);
    setPlayback(current => ({ ...current, [name]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeMainTab === "profile") return;
    saveApiKeys(keys);
    savePlaybackPreferences(playback);
    setSaved(true);
  }

  function selectMainTab(tab: MainTab) {
    setSaved(false);
    setActiveMainTab(tab);
    navigate(tab === "playback" ? "/settings" : `/settings?tab=${tab}`, { replace: true });
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

  function saveProfile() {
    if (!activeProfile) return;
    if (!profileName.trim()) {
      setProfileError("El perfil necesita un nombre.");
      return;
    }
    const updated = updateLocalProfile(activeProfile.id, {
      name: profileName,
      pin: profilePin,
      avatarDataUrl: profileAvatar,
    });
    setProfileError("");
    setSaved(true);
    if (updated) setActiveProfileState(updated);
    setProfiles(getLocalProfiles());
  }

  function createProfile() {
    if (!newProfileName.trim()) {
      setProfileError("Escribe un nombre para crear la cuenta.");
      return;
    }
    createLocalProfile(
      { name: newProfileName, pin: newProfilePin, avatarDataUrl: newProfileAvatar },
      { makeActive: true }
    );
    window.location.reload();
  }

  function switchProfile(profile: LocalProfile) {
    if (profile.id === activeProfile?.id) return;
    if (profile.pin) {
      const enteredPin = window.prompt("PIN del perfil");
      if (enteredPin !== profile.pin) {
        setProfileError("PIN incorrecto.");
        return;
      }
    }
    setActiveProfile(profile.id);
    window.location.reload();
  }

  return (
    <PageContainer className="min-h-screen py-8 animate-fadeIn">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header>
          <h1 className="mb-2 text-3xl font-bold text-text-primary">Ajustes</h1>
          <p className="text-sm text-text-secondary">Preferencias locales de reproduccion y servicios externos.</p>
        </header>

        <form onSubmit={submit} className="liquid-glass-dark rounded-lg p-6">
          <div className="mb-6 flex flex-wrap gap-2">
            <TabButton active={activeMainTab === "playback"} onClick={() => selectMainTab("playback")}>
              <PlayCircle size={16} />
              Reproduccion
            </TabButton>
            <TabButton active={activeMainTab === "profile"} onClick={() => selectMainTab("profile")}>
              <UserRound size={16} />
              Perfil
            </TabButton>
            <TabButton active={activeMainTab === "services"} onClick={() => selectMainTab("services")}>
              <KeyRound size={16} />
              Servicios
            </TabButton>
          </div>

          {activeMainTab === "profile" ? (
            <ProfileSettings
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
              onSwitchProfile={switchProfile}
            />
          ) : activeMainTab === "playback" ? (
            <section>
              <div className="mb-5">
                <h2 className="text-lg font-bold text-white">Reproduccion</h2>
                <p className="mt-1 text-sm text-white/54">
                  Preferencias estilo Nuvio para audio, fuentes, episodios y subtitulos.
                </p>
              </div>

              <div className="mb-5 flex flex-wrap gap-2">
                <TabButton compact active={activePlaybackTab === "audio"} onClick={() => setActivePlaybackTab("audio")}>
                  <Volume2 size={15} />
                  Audio y fuentes
                </TabButton>
                <TabButton compact active={activePlaybackTab === "subtitles"} onClick={() => setActivePlaybackTab("subtitles")}>
                  <Captions size={15} />
                  Subtitulos
                </TabButton>
              </div>

              {activePlaybackTab === "audio" ? (
                <div className="grid gap-5">
                  <SettingsSection title="Audio">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField
                        label="Primer idioma de audio preferido"
                        value={playback.firstAudioLanguage}
                        options={LANGUAGE_OPTIONS}
                        onChange={value => updatePlayback("firstAudioLanguage", value)}
                      />
                      <SelectField
                        label="Segundo idioma de audio preferido"
                        value={playback.secondAudioLanguage}
                        options={LANGUAGE_OPTIONS}
                        onChange={value => updatePlayback("secondAudioLanguage", value)}
                      />
                    </div>
                  </SettingsSection>

                  <SettingsSection title="Seleccion de fuentes">
                    <div className="grid gap-4">
                      <ToggleField
                        label="Reutilizar ultimo enlace"
                        checked={playback.reuseLastLink}
                        onChange={checked => updatePlayback("reuseLastLink", checked)}
                      />
                      <NumberField
                        label="Duracion de la cache del ultimo enlace"
                        suffix="horas"
                        min={1}
                        max={720}
                        value={playback.lastLinkCacheHours}
                        onChange={value => updatePlayback("lastLinkCacheHours", value)}
                      />
                      <SegmentedField<SourceSelectionMode>
                        label="Seleccion automatica de fuente"
                        value={playback.sourceSelectionMode}
                        options={[
                          { value: "manual", label: "Manual" },
                          { value: "first", label: "Autoreproducir primera fuente" },
                        ]}
                        onChange={value => updatePlayback("sourceSelectionMode", value)}
                      />
                      <ToggleField
                        label="Auto reproducir siguiente episodio"
                        checked={playback.autoPlayNextEpisode}
                        onChange={checked => updatePlayback("autoPlayNextEpisode", checked)}
                      />
                      <RangeField
                        label="Umbral del siguiente episodio"
                        value={playback.nextEpisodeThresholdPercent}
                        min={50}
                        max={100}
                        suffix="%"
                        onChange={value => updatePlayback("nextEpisodeThresholdPercent", value)}
                      />
                    </div>
                  </SettingsSection>
                </div>
              ) : (
                <SettingsSection title="Subtitulos">
                  <div className="grid gap-4">
                    <SelectField
                      label="Idioma de subtitulos preferidos"
                      value={playback.preferredSubtitleLanguage}
                      options={LANGUAGE_OPTIONS}
                      onChange={value => updatePlayback("preferredSubtitleLanguage", value)}
                    />
                    <SegmentedField<AddonSubtitleLoadMode>
                      label="Carga de subtitulos de addons"
                      value={playback.addonSubtitleLoadMode}
                      options={[
                        { value: "preferred", label: "Con idiomas preferidos" },
                        { value: "all", label: "Todos los subs de addons" },
                      ]}
                      onChange={value => updatePlayback("addonSubtitleLoadMode", value)}
                    />
                  </div>
                </SettingsSection>
              )}
            </section>
          ) : (
            <section>
              <div className="mb-5">
                <h2 className="text-lg font-bold text-white">Servicios de metadata y skip</h2>
                <p className="mt-1 text-sm text-white/54">
                  Las claves se guardan solo en este equipo. TMDB es necesaria para busqueda, hero, trailers y metadatos enriquecidos.
                </p>
              </div>

              <div className="grid gap-4">
                <ApiKeyField
                  label="TMDB API Key"
                  value={keys.tmdbApiKey}
                  placeholder="Tu clave de The Movie Database"
                  onChange={value => updateKey("tmdbApiKey", value)}
                />
                <ApiKeyField
                  label="IntroDB API Key"
                  value={keys.introDbApiKey}
                  placeholder="Opcional para enviar timestamps; la lectura no requiere clave"
                  onChange={value => updateKey("introDbApiKey", value)}
                />
                <ApiKeyField
                  label="Anime-Skip Client ID"
                  value={keys.animeSkipClientId}
                  placeholder="X-Client-ID de anime-skip.com"
                  onChange={value => updateKey("animeSkipClientId", value)}
                />
              </div>
            </section>
          )}

          {activeMainTab !== "profile" ? (
            <div className="mt-6 flex items-center gap-3">
              <button type="submit" className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-white/86">
                <Save size={15} />
                Guardar
              </button>
              {saved ? <span className="text-sm text-white/64">Guardado.</span> : null}
            </div>
          ) : null}
        </form>
      </div>
    </PageContainer>
  );
}

function ProfileSettings({
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
  onProfileNameChange,
  onProfilePinChange,
  onNewProfileNameChange,
  onNewProfilePinChange,
  onChooseProfileImage,
  onChooseNewProfileImage,
  onSaveProfile,
  onCreateProfile,
  onSwitchProfile,
}: {
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
  onProfileNameChange: (value: string) => void;
  onProfilePinChange: (value: string) => void;
  onNewProfileNameChange: (value: string) => void;
  onNewProfilePinChange: (value: string) => void;
  onChooseProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onChooseNewProfileImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onSaveProfile: () => void;
  onCreateProfile: () => void;
  onSwitchProfile: (profile: LocalProfile) => void;
}) {
  const activePreview = activeProfile
    ? { ...activeProfile, name: profileName, pin: profilePin, avatarDataUrl: profileAvatar }
    : null;
  const newPreview: LocalProfile = {
    id: "new-profile-preview",
    name: newProfileName || "Nuevo",
    pin: newProfilePin || undefined,
    avatarDataUrl: newProfileAvatar,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-white">Perfil local</h2>
        <p className="mt-1 text-sm text-white/54">
          Cada perfil mantiene su propio progreso, ajustes de reproduccion, servicios y add-ons.
        </p>
      </div>

      <div className="grid gap-5">
        <SettingsSection title="Cuenta actual">
          {activePreview ? (
            <div className="grid gap-5 md:grid-cols-[auto,1fr]">
              <div className="flex flex-col items-center gap-3">
                <ProfileAvatar profile={activePreview} className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-white text-black" />
                <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-xs font-bold text-white/72 transition hover:bg-white/14 hover:text-white">
                  <ImagePlus size={14} />
                  Cambiar foto
                  <input type="file" accept="image/*" onChange={onChooseProfileImage} className="hidden" />
                </label>
              </div>

              <div className="grid gap-4">
                <TextField label="Nombre" value={profileName} placeholder="Nombre del perfil" onChange={onProfileNameChange} />
                <TextField label="PIN opcional" value={profilePin} placeholder="Sin PIN" password numeric onChange={onProfilePinChange} />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onSaveProfile}
                    className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-white/86"
                  >
                    <Save size={15} />
                    Guardar perfil
                  </button>
                  {saved ? <span className="text-sm text-white/64">Guardado.</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </SettingsSection>

        <SettingsSection title="Perfiles en este equipo">
          <div className="grid gap-3">
            {profiles.map(profile => {
              const isActive = profile.id === activeProfile?.id;
              return (
                <div key={profile.id} className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/18 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProfileAvatar profile={profile} className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white text-black" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{profile.name}</p>
                      <p className="text-xs text-white/42">{profile.pin ? "PIN activo" : "Sin PIN"}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSwitchProfile(profile)}
                    disabled={isActive}
                    className={[
                      "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-xs font-black transition",
                      isActive ? "bg-white/12 text-white/44" : "bg-white text-black hover:bg-white/86",
                    ].join(" ")}
                  >
                    <LogIn size={14} />
                    {isActive ? "Activo" : "Entrar"}
                  </button>
                </div>
              );
            })}
          </div>
        </SettingsSection>

        <SettingsSection title="Crear otra cuenta">
          <div className="grid gap-5 md:grid-cols-[auto,1fr]">
            <div className="flex flex-col items-center gap-3">
              <ProfileAvatar profile={newPreview} className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-white text-black" />
              <label className="flex cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-xs font-bold text-white/72 transition hover:bg-white/14 hover:text-white">
                <ImagePlus size={14} />
                Foto
                <input type="file" accept="image/*" onChange={onChooseNewProfileImage} className="hidden" />
              </label>
            </div>
            <div className="grid gap-4">
              <TextField label="Nombre" value={newProfileName} placeholder="Nombre de la cuenta" onChange={onNewProfileNameChange} />
              <TextField label="PIN opcional" value={newProfilePin} placeholder="Sin PIN" password numeric onChange={onNewProfilePinChange} />
              <button
                type="button"
                onClick={onCreateProfile}
                className="flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-white/86"
              >
                <Plus size={15} />
                Crear y entrar
              </button>
            </div>
          </div>
        </SettingsSection>
      </div>

      {profileError ? <p className="mt-4 text-sm font-semibold text-red-300">{profileError}</p> : null}
    </section>
  );
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
        className="w-full rounded-lg border border-white/12 bg-white/10 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/34 focus:border-white/34"
      />
    </label>
  );
}

function TabButton({
  active,
  compact,
  children,
  onClick,
}: {
  active: boolean;
  compact?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2 rounded-full border font-bold transition",
        compact ? "px-4 py-2 text-xs" : "px-5 py-2.5 text-sm",
        active ? "border-white/32 bg-white text-black" : "border-white/12 bg-white/8 text-white/68 hover:bg-white/14 hover:text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function getInitialMainTab(search: string): MainTab {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "profile" || tab === "services") return tab;
  return "playback";
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
      <h3 className="mb-4 text-sm font-black uppercase text-white/72">{title}</h3>
      {children}
    </div>
  );
}

function ApiKeyField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-white/86">{label}</span>
      <input
        type="password"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/12 bg-white/10 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/34 focus:border-white/34"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-white/86">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/12 bg-[#171719] px-4 py-3 text-sm text-white outline-none transition focus:border-white/34"
      >
        {options.map(option => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/18 px-4 py-3">
      <span className="text-sm font-semibold text-white/86">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="h-5 w-5 accent-white"
      />
    </label>
  );
}

function NumberField({
  label,
  suffix,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-white/86">{label}</span>
      <div className="flex items-center gap-3 rounded-lg border border-white/12 bg-white/10 px-4 py-2.5">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={event => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
        />
        <span className="text-xs font-bold text-white/46">{suffix}</span>
      </div>
    </label>
  );
}

function RangeField({
  label,
  suffix,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-lg border border-white/10 bg-black/18 px-4 py-3">
      <span className="mb-3 flex items-center justify-between gap-3 text-sm font-semibold text-white/86">
        <span>{label}</span>
        <span className="text-white">{value}{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="w-full accent-white"
      />
    </label>
  );
}

function SegmentedField<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-white/86">{label}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "rounded-lg border px-4 py-3 text-left text-sm font-bold transition",
              value === option.value ? "border-white/34 bg-white text-black" : "border-white/12 bg-white/8 text-white/64 hover:bg-white/14 hover:text-white",
            ].join(" ")}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
