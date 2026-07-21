import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import clsx from "clsx";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Compass,
  ExternalLink,
  KeyRound,
  Library,
  Lock,
  PlayCircle,
  Puzzle,
  Search,
  Settings,
  Share2,
  Sparkles,
  UserRound,
} from "lucide-react";
import aetherioLogo from "../assets/aetheriologo.png";
import ProfileAvatar from "../components/profile/ProfileAvatar";
import { EMPTY_API_KEYS, getApiKeys, getApiKeysForProfile, saveApiKeys, validateTmdbApiKey, type ApiKeys } from "../config/apiKeys";
import {
  DEFAULT_PLAYBACK_PREFERENCES,
  getPlaybackPreferences,
  LANGUAGE_OPTIONS,
  savePlaybackPreferences,
  type PlaybackPreferences,
} from "../config/playbackPreferences";
import { completeQuickStart } from "../config/quickStart";
import {
  DEFAULT_HOME_PREFERENCES,
  getHomePreferences,
  saveHomePreferences,
  type ContentOrientation,
  type HomePreferences,
} from "../config/homePreferences";
import { openExternalUrl } from "../runtime/platform";
import {
  createLocalProfile,
  getLocalProfiles,
  readImageFileAsDataUrl,
  verifyPin,
  type LocalProfile,
} from "../utils/localProfiles";
import mugiwaraSeekLogo from "../assets/mugiwara-seeklogo.png";

type QuickStartStep = "profile" | "welcome" | "content" | "playback" | "apis" | "addons";

interface QuickStartProps {
  installedAddons: number;
  activeProfile: LocalProfile | null;
  useFreshDefaults?: boolean;
  onComplete: (destination: "/home" | "/addons") => void;
}

export default function QuickStart({ installedAddons, activeProfile, useFreshDefaults = false, onComplete }: QuickStartProps) {
  const [includeProfileStep] = useState(() => activeProfile === null);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<LocalProfile | null>(activeProfile);
  const [profileName, setProfileName] = useState("");
  const [profilePin, setProfilePin] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>();
  const [profileError, setProfileError] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [keys, setKeys] = useState<ApiKeys>(() => useFreshDefaults ? { ...EMPTY_API_KEYS } : getApiKeys());
  const [apiError, setApiError] = useState("");
  const [validatingApi, setValidatingApi] = useState(false);
  const [validatedTmdbKey, setValidatedTmdbKey] = useState("");
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => useFreshDefaults ? { ...DEFAULT_PLAYBACK_PREFERENCES } : getPlaybackPreferences());
  const [homePreferences, setHomePreferences] = useState<HomePreferences>(() => useFreshDefaults
    ? { ...DEFAULT_HOME_PREFERENCES, catalogOrder: [], hiddenCatalogKeys: [] }
    : getHomePreferences());
  const steps: QuickStartStep[] = includeProfileStep
    ? ["profile", "welcome", "content", "playback", "apis", "addons"]
    : ["welcome", "content", "playback", "apis", "addons"];
  const currentStep = steps[step];

  function persistSelections() {
    saveApiKeys(keys);
    savePlaybackPreferences(playback);
    saveHomePreferences(homePreferences);
  }

  async function createProfileAndContinue() {
    if (!profileName.trim()) {
      setProfileError("Escribe un nombre para crear el perfil.");
      return;
    }
    setCreatingProfile(true);
    setProfileError("");
    try {
      const isFirstProfile = getLocalProfiles().length === 0;
      const created = await createLocalProfile(
        { name: profileName, pin: profilePin, avatarDataUrl: profileAvatar },
        { makeActive: true, adoptCurrentData: isFirstProfile },
      );
      setProfile(created);
      setStep(1);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "No se pudo crear el perfil.");
    } finally {
      setCreatingProfile(false);
    }
  }

  async function chooseProfileImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setProfileAvatar(await readImageFileAsDataUrl(file));
      setProfileError("");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "No se pudo leer la imagen.");
    }
  }

  function finish(destination: "/home" | "/addons") {
    persistSelections();
    completeQuickStart();
    onComplete(destination);
  }

  async function requireValidTmdbKey() {
    const tmdbApiKey = keys.tmdbApiKey.trim();
    if (!tmdbApiKey) {
      setApiError("La API key de TMDB es obligatoria para continuar.");
      return false;
    }
    if (validatedTmdbKey === tmdbApiKey) return true;

    setValidatingApi(true);
    setApiError("");
    const valid = await validateTmdbApiKey(tmdbApiKey);
    setValidatingApi(false);
    if (!valid) {
      setApiError("No pudimos validar esta API key. Revisa que sea una clave v3 válida de TMDB.");
      return false;
    }
    setValidatedTmdbKey(tmdbApiKey);
    return true;
  }

  async function continueToNextStep() {
    if (currentStep === "profile") {
      await createProfileAndContinue();
      return;
    }
    if (currentStep === "apis" && !await requireValidTmdbKey()) return;
    setStep(current => Math.min(steps.length - 1, current + 1));
  }

  async function skip() {
    if (!profile) return;
    if (!await requireValidTmdbKey()) {
      setStep(steps.indexOf("apis"));
      return;
    }
    persistSelections();
    completeQuickStart();
    onComplete(installedAddons > 0 ? "/home" : "/addons");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#171717] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.12),transparent_28%),radial-gradient(circle_at_15%_85%,rgba(255,255,255,0.07),transparent_32%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-6 py-6 md:px-10 md:py-8">
        <header className="flex items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <img src={aetherioLogo} alt="Aetherio" className="h-11 w-11 rounded-xl object-contain" />
            <div>
              <p className="text-sm font-black tracking-tight">Aetherio</p>
              <p className="text-xs font-semibold text-white/42">Quick Start</p>
            </div>
          </div>
          {profile ? (
            <button
              type="button"
              onClick={() => void skip()}
              className="gsap-transition rounded-full px-4 py-2 text-sm font-bold text-white/54 hover:bg-white/8 hover:text-white"
            >
              Omitir recorrido
            </button>
          ) : <span />}
        </header>

        <div className="mt-7 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={`Paso ${step + 1} de ${steps.length}`}>
          {steps.map((stepName, index) => (
            <div
              key={stepName}
              className={clsx("h-1 rounded-full", index <= step ? "bg-white" : "bg-white/14")}
            />
          ))}
        </div>

        <section key={step} className="aetherio-page-enter flex flex-1 items-center py-8 md:py-12">
          {currentStep === "profile" ? (
            <ProfileStep
              name={profileName}
              pin={profilePin}
              avatarDataUrl={profileAvatar}
              error={profileError}
              onNameChange={setProfileName}
              onPinChange={setProfilePin}
              onChooseImage={chooseProfileImage}
            />
          ) : null}
          {currentStep === "welcome" ? <WelcomeStep profileName={profile?.name ?? "Aetherio"} /> : null}
          {currentStep === "content" ? (
            <ContentStep
              orientation={homePreferences.contentOrientation}
              onChange={contentOrientation => setHomePreferences(current => ({ ...current, contentOrientation }))}
            />
          ) : null}
          {currentStep === "playback" ? <PlaybackStep playback={playback} onChange={setPlayback} /> : null}
          {currentStep === "apis" ? (
            <ApiStep
              keys={keys}
              error={apiError}
              validating={validatingApi}
              onChange={next => {
                setKeys(next);
                setApiError("");
                setValidatedTmdbKey("");
              }}
            />
          ) : null}
          {currentStep === "addons" ? <AddonsStep installedAddons={installedAddons} /> : null}
        </section>

        <footer className="flex items-center justify-between gap-4 pb-2">
          <button
            type="button"
            onClick={() => setStep(current => Math.max(0, current - 1))}
            disabled={step === 0 || creatingProfile}
            className="gsap-transition flex items-center gap-2 rounded-full border border-white/12 px-5 py-3 text-sm font-black text-white disabled:pointer-events-none disabled:opacity-0 hover:bg-white/10"
          >
            <ChevronLeft size={17} />
            Atrás
          </button>

          {step < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => void continueToNextStep()}
              disabled={creatingProfile || validatingApi || (currentStep === "apis" && !keys.tmdbApiKey.trim())}
              className="gsap-transition flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-black disabled:opacity-55 hover:bg-white/82"
            >
              {currentStep === "profile"
                ? (creatingProfile ? "Creando perfil..." : "Crear perfil y continuar")
                : currentStep === "apis" && validatingApi
                  ? "Validando TMDB..."
                  : "Continuar"}
              <ChevronRight size={17} />
            </button>
          ) : (
            <div className="flex flex-wrap justify-end gap-3">
              {installedAddons === 0 ? (
                <button
                  type="button"
                  onClick={() => finish("/addons")}
                  className="gsap-transition flex items-center gap-2 rounded-full border border-white/16 px-5 py-3 text-sm font-black hover:bg-white/10"
                >
                  <Puzzle size={17} />
                  Configurar complementos
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => finish("/home")}
                className="gsap-transition flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-black hover:bg-white/82"
              >
                <Check size={17} />
                Ir a Aetherio
              </button>
            </div>
          )}
        </footer>
      </div>
    </main>
  );
}

function ContentStep({ orientation, onChange }: { orientation: ContentOrientation; onChange: (value: ContentOrientation) => void }) {
  const choices: Array<{ value: ContentOrientation; title: string; description: string }> = [
    {
      value: "movies-series",
      title: "Películas y series",
      description: "Prioriza el contenido live action y general en Inicio.",
    },
    {
      value: "anime",
      title: "Anime",
      description: "Coloca primero los catálogos y estrenos de anime.",
    },
    {
      value: "both",
      title: "Quiero los dos",
      description: "Mantiene una experiencia mixta con todo el contenido.",
    },
  ];

  return (
    <div className="grid w-full gap-9 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
      <StepIntroduction
        icon={<Compass size={22} />}
        eyebrow="Tus gustos"
        title="¿Qué quieres ver principalmente?"
        description="Usaremos esta elección para ordenar Inicio y destacar primero lo que más te interesa. Nada queda bloqueado y podrás cambiarlo en Ajustes."
      />

      <div className="grid gap-3">
        {choices.map(choice => {
          const isSelected = orientation === choice.value;
          const isAnime = choice.value === "anime";

          return (
            <button
              key={choice.value}
              type="button"
              onClick={() => onChange(choice.value)}
              className={clsx(
                "gsap-transition flex items-center gap-5 rounded-[26px] border p-5 text-left md:p-6",
                isSelected
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-white/[0.055] text-white hover:bg-white/10",
              )}
            >
              <span className={clsx(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                isAnime ? "bg-transparent" : isSelected ? "bg-black text-white" : "bg-white/10 text-white/68",
              )}>
                {isAnime ? (
                  <>
                    <img src={mugiwaraSeekLogo} alt="" className="h-10 w-10 object-contain" />
                    {isSelected ? (
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black text-white">
                        <Check size={13} />
                      </span>
                    ) : null}
                  </>
                ) : isSelected ? <Check size={20} /> : <Clapperboard size={20} />}
              </span>
              <span>
                <span className="block text-base font-black">{choice.title}</span>
                <span className={clsx("mt-1 block text-sm font-medium", isSelected ? "text-black/56" : "text-white/44")}>{choice.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfileStep({
  name,
  pin,
  avatarDataUrl,
  error,
  onNameChange,
  onPinChange,
  onChooseImage,
}: {
  name: string;
  pin: string;
  avatarDataUrl?: string;
  error: string;
  onNameChange: (value: string) => void;
  onPinChange: (value: string) => void;
  onChooseImage: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const previewProfile: LocalProfile = {
    id: "quick-start-preview",
    name: name || "Aetherio",
    avatarDataUrl,
    createdAt: 0,
    updatedAt: 0,
  };

  return (
    <div className="grid w-full gap-9 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
      <StepIntroduction
        icon={<UserRound size={22} />}
        eyebrow="Tu perfil"
        title="Primero, ¿cómo te llamamos?"
        description="Cada perfil mantiene sus propias claves, preferencias, progreso y conexiones. El PIN y la foto son opcionales."
      />

      <div className="grid gap-5 rounded-[30px] border border-white/10 bg-white/[0.055] p-6 shadow-2xl md:p-8">
        <div className="flex items-center gap-4">
          <ProfileAvatar profile={previewProfile} className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-xl font-black text-black" />
          <div>
            <p className="text-lg font-black">{name.trim() || "Tu nuevo perfil"}</p>
            <p className="text-xs font-semibold text-white/42">Guardado localmente en este equipo</p>
          </div>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-black text-white/78">Nombre</span>
          <input
            value={name}
            onChange={event => onNameChange(event.target.value)}
            autoFocus
            maxLength={32}
            placeholder="Tu nombre"
            className="w-full rounded-full border border-white/12 bg-white px-4 py-3 text-sm font-semibold text-black outline-none placeholder:text-black/38 focus:border-white/42"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-black text-white/78">PIN opcional</span>
          <input
            value={pin}
            onChange={event => onPinChange(event.target.value.replace(/\D/g, "").slice(0, 8))}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="Sin PIN"
            className="w-full rounded-full border border-white/12 bg-white px-4 py-3 text-sm font-semibold text-black outline-none placeholder:text-black/38 focus:border-white/42"
          />
        </label>

        <label className="block cursor-pointer rounded-[20px] border border-dashed border-white/16 bg-white/[0.04] p-4 gsap-transition hover:bg-white/8">
          <span className="block text-sm font-black">Elegir foto</span>
          <span className="mt-1 block text-xs font-medium text-white/42">PNG, JPG o WEBP desde tu equipo.</span>
          <input type="file" accept="image/*" onChange={onChooseImage} className="sr-only" />
        </label>

        {error ? <p className="text-sm font-bold text-red-300">{error}</p> : null}
      </div>
    </div>
  );
}

function WelcomeStep({ profileName }: { profileName: string }) {
  const areas = [
    { icon: <Clapperboard size={20} />, title: "Inicio", description: "Tus catálogos y recomendaciones." },
    { icon: <Search size={20} />, title: "Buscar", description: "Películas, series, anime y personas." },
    { icon: <Library size={20} />, title: "Biblioteca", description: "Progreso y contenido guardado." },
    { icon: <Settings size={20} />, title: "Ajustes", description: "Perfiles, fuentes e integraciones." },
  ];

  return (
    <div className="grid w-full gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] lg:items-center">
      <div className="max-w-xl">
        <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/7 px-3 py-1.5 text-xs font-black text-white/68">
          <Sparkles size={14} />
          Primera configuración
        </span>
        <h1 className="text-4xl font-black leading-[0.98] tracking-[-0.05em] md:text-6xl">
          Hola, {profileName}.
          <span className="mt-2 block text-white/38">Hagamos que Aetherio sea tuyo.</span>
        </h1>
        <p className="mt-6 max-w-lg text-base font-medium leading-7 text-white/58">
          En unos pasos configuraremos cómo quieres encontrar y reproducir contenido. Todo se guarda únicamente para este perfil.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {areas.map(area => (
          <InfoCard key={area.title} icon={area.icon} title={area.title} description={area.description} />
        ))}
      </div>
    </div>
  );
}

function PlaybackStep({
  playback,
  onChange,
}: {
  playback: PlaybackPreferences;
  onChange: (next: PlaybackPreferences) => void;
}) {
  function patch(next: Partial<PlaybackPreferences>) {
    onChange({ ...playback, ...next });
  }

  return (
    <div className="grid w-full gap-9 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
      <StepIntroduction
        icon={<PlayCircle size={22} />}
        eyebrow="Reproducción"
        title="Tu idioma, tus reglas."
        description="Aetherio usará estas preferencias para ordenar audios, subtítulos y fuentes. Podrás cambiarlas luego en Ajustes."
      />

      <div className="grid gap-4 rounded-[28px] border border-white/10 bg-white/[0.055] p-5 shadow-2xl md:p-7">
        <SelectField
          label="Audio preferido"
          value={playback.firstAudioLanguage}
          onChange={value => patch({ firstAudioLanguage: value })}
        />
        <SelectField
          label="Subtítulos preferidos"
          value={playback.preferredSubtitleLanguage}
          onChange={value => patch({ preferredSubtitleLanguage: value })}
        />
        <div>
          <p className="mb-2 text-sm font-black text-white/78">Al encontrar varias fuentes</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceButton
              selected={playback.sourceSelectionMode === "manual"}
              title="Preguntarme"
              description="Mostrar la lista y dejarme elegir."
              onClick={() => patch({ sourceSelectionMode: "manual" })}
            />
            <ChoiceButton
              selected={playback.sourceSelectionMode === "first"}
              title="Elegir la primera"
              description="Comenzar con la mejor coincidencia."
              onClick={() => patch({ sourceSelectionMode: "first" })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiStep({
  keys,
  error,
  validating,
  onChange,
}: {
  keys: ApiKeys;
  error: string;
  validating: boolean;
  onChange: (next: ApiKeys) => void;
}) {
  const profilesWithKeys = useMemo(() => {
    const all = getLocalProfiles();
    return all.filter(p => {
      const k = getApiKeysForProfile(p.id);
      return k.tmdbApiKey || k.introDbApiKey || k.animeSkipClientId;
    });
  }, []);

  const [sharing, setSharing] = useState<{ profile: LocalProfile; pin: string; error: string } | null>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sharing) pinRef.current?.focus();
  }, [sharing]);

  async function handleShare(profile: LocalProfile) {
    if (!profile.pin) {
      const k = getApiKeysForProfile(profile.id);
      onChange(k);
      return;
    }
    setSharing({ profile, pin: "", error: "" });
  }

  async function submitSharingPin() {
    if (!sharing) return;
    const valid = await verifyPin(sharing.pin, sharing.profile.pin!);
    if (!valid) {
      setSharing(prev => prev ? { ...prev, pin: "", error: "PIN incorrecto" } : null);
      return;
    }
    const k = getApiKeysForProfile(sharing.profile.id);
    onChange(k);
    setSharing(null);
  }

  const integrations: Array<{
    key: keyof ApiKeys;
    title: string;
    description: string;
    placeholder: string;
    url: string;
    important?: boolean;
  }> = [
    {
      key: "tmdbApiKey",
      title: "TMDB API Key",
      description: "Activa búsqueda, imágenes, logos, trailers y metadata enriquecida.",
      placeholder: "Pega tu API key de TMDB",
      url: "https://www.themoviedb.org/settings/api",
      important: true,
    },
    {
      key: "introDbApiKey",
      title: "IntroDB API Key",
      description: "Opcional. Permite colaborar enviando segmentos de intro y resumen.",
      placeholder: "Opcional",
      url: "https://www.introdb.app/",
    },
    {
      key: "animeSkipClientId",
      title: "Anime Skip Client ID",
      description: "Opcional. Ayuda a detectar intros y endings en anime.",
      placeholder: "Opcional",
      url: "https://anime-skip.com/",
    },
  ];

  return (
    <div className="grid w-full gap-9 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
      <StepIntroduction
        icon={<KeyRound size={22} />}
        eyebrow="Integraciones"
        title="Conecta los servicios importantes."
        description="La API key de TMDB es obligatoria porque alimenta el Home, la búsqueda y la metadata. IntroDB y Anime Skip siguen siendo opcionales."
      />

      <div className="grid gap-3">
        {integrations.map(integration => (
          <div key={integration.key} className="rounded-[24px] border border-white/10 bg-white/[0.055] p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black">{integration.title}</h3>
                  {integration.important ? (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-black">Obligatoria</span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs font-medium leading-5 text-white/46">{integration.description}</p>
              </div>
              <button
                type="button"
                onClick={() => void openExternalUrl(integration.url)}
                className="gsap-transition flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black text-white/62 hover:bg-white/10 hover:text-white"
              >
                Obtener clave
                <ExternalLink size={13} />
              </button>
            </div>
            <input
              type="password"
              value={keys[integration.key]}
              onChange={event => onChange({ ...keys, [integration.key]: event.target.value })}
              placeholder={integration.placeholder}
              autoComplete="off"
              className="w-full rounded-full border border-white/12 bg-white px-4 py-2.5 text-sm font-semibold text-black outline-none placeholder:text-black/38 focus:border-white/42"
            />
          </div>
        ))}

        {profilesWithKeys.length > 0 ? (
          <div className="rounded-[24px] border border-white/10 bg-white/[0.055] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Share2 size={15} className="text-white/46" />
              <h3 className="text-sm font-black text-white/78">Compartir claves desde otro perfil</h3>
            </div>
            <p className="mb-4 text-xs font-medium leading-5 text-white/46">
              Selecciona un perfil que ya tenga claves configuradas y tráelas aquí. Si tiene PIN, ingrésalo para autorizar.
            </p>
            <div className="flex flex-wrap gap-3">
              {profilesWithKeys.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handleShare(p)}
                  disabled={sharing !== null}
                  className="gsap-transition flex items-center gap-2.5 rounded-full border border-white/12 px-3.5 py-2 text-xs font-bold text-white/68 hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <ProfileAvatar profile={p} className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white/20 text-[10px] font-black text-black" />
                  {p.name}
                  {p.pin ? <Lock size={12} className="text-white/34" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {sharing ? (
          <div className="rounded-[24px] border border-white/12 bg-white/[0.08] p-5">
            <div className="flex items-center gap-3 mb-3">
              <ProfileAvatar profile={sharing.profile} className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/20 text-sm font-black text-black" />
              <div>
                <p className="text-sm font-black text-white">{sharing.profile.name}</p>
                <p className="text-xs font-medium text-white/46">Introduce el PIN para compartir sus claves</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={sharing.pin}
                onChange={e =>
                  setSharing(prev => prev ? { ...prev, pin: e.target.value.replace(/\D/g, ""), error: "" } : null)
                }
                onKeyDown={e => { if (e.key === "Enter") void submitSharingPin(); }}
                placeholder="PIN"
                className="w-full rounded-full border border-white/12 bg-white px-4 py-2.5 text-sm font-semibold text-black outline-none placeholder:text-black/38 focus:border-white/42"
              />
              <button
                type="button"
                onClick={() => void submitSharingPin()}
                disabled={!sharing.pin.trim()}
                className="shrink-0 rounded-full bg-white px-4 py-2.5 text-sm font-black text-black disabled:opacity-40"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={() => setSharing(null)}
                className="shrink-0 rounded-full border border-white/12 px-4 py-2.5 text-sm font-bold text-white/68 hover:bg-white/10"
              >
                Cancelar
              </button>
            </div>
            {sharing.error ? (
              <p className="mt-2 text-xs font-bold text-red-300">{sharing.error}</p>
            ) : null}
          </div>
        ) : null}

        {validating ? <p className="text-sm font-bold text-white/62">Comprobando la clave con TMDB...</p> : null}
        {error ? <p role="alert" className="text-sm font-bold text-red-300">{error}</p> : null}
      </div>
    </div>
  );
}

function AddonsStep({ installedAddons }: { installedAddons: number }) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-9 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
      <StepIntroduction
        icon={<Puzzle size={22} />}
        eyebrow="Complementos"
        title="Las fuentes dan vida a Aetherio."
        description="Los complementos aportan catálogos, metadata y enlaces de reproducción. Puedes instalar una URL de manifest y decidir cuáles permanecen activos."
      />

      <div className="rounded-[30px] border border-white/10 bg-white/[0.055] p-7 shadow-2xl md:p-9">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-black">
            {installedAddons > 0 ? <Check size={27} /> : <Compass size={27} />}
          </div>
          <div>
            <p className="text-3xl font-black tracking-tight">{installedAddons}</p>
            <p className="text-sm font-bold text-white/48">
              {installedAddons === 1 ? "complemento instalado" : "complementos instalados"}
            </p>
          </div>
        </div>
        <div className="my-6 h-px bg-white/10" />
        <p className="text-sm font-medium leading-6 text-white/58">
          {installedAddons > 0
            ? "Ya puedes entrar. Más adelante podrás administrar tus complementos desde la barra lateral o Ajustes."
            : "Te llevaremos a Complementos al terminar para que agregues tu primera fuente. También puedes entrar ahora y hacerlo más tarde."}
        </p>
      </div>
    </div>
  );
}

function StepIntroduction({ icon, eyebrow, title, description }: { icon: ReactNode; eyebrow: string; title: string; description: string }) {
  return (
    <div className="max-w-xl">
      <span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-black">{icon}</span>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-white/38">{eyebrow}</p>
      <h2 className="mt-3 text-4xl font-black leading-[1.02] tracking-[-0.04em] md:text-5xl">{title}</h2>
      <p className="mt-5 text-base font-medium leading-7 text-white/56">{description}</p>
    </div>
  );
}

function InfoCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <article className="rounded-[24px] border border-white/10 bg-white/[0.055] p-5">
      <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white/72">{icon}</span>
      <h3 className="text-base font-black">{title}</h3>
      <p className="mt-1 text-sm font-medium text-white/44">{description}</p>
    </article>
  );
}

function SelectField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black text-white/78">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-full border border-white/12 bg-white px-4 py-3 text-sm font-bold text-black outline-none focus:border-white/42"
      >
        {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ChoiceButton({
  selected,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "gsap-transition rounded-[20px] border p-4 text-left",
        selected ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.04] text-white hover:bg-white/10",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-black">
        {selected ? <Check size={15} /> : null}
        {title}
      </span>
      <span className={clsx("mt-1 block text-xs font-medium", selected ? "text-black/58" : "text-white/42")}>{description}</span>
    </button>
  );
}
