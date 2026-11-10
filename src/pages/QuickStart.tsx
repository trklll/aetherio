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
  Lock,
  PlayCircle,
  Puzzle,
  Share2,
} from "lucide-react";
import aetherioLogo from "../assets/aetheriologo.png";
import ProfileAvatar from "../components/profile/ProfileAvatar.tsx";
import { EMPTY_API_KEYS, getApiKeys, getApiKeysForProfile, saveApiKeys, type ApiKeys } from "../config/apiKeys.ts";
import {
  DEFAULT_PLAYBACK_PREFERENCES,
  getPlaybackPreferences,
  LANGUAGE_OPTIONS,
  savePlaybackPreferences,
  type PlaybackPreferences,
} from "../config/playbackPreferences.ts";
import { completeQuickStart } from "../config/quickStart.ts";
import {
  DEFAULT_HOME_PREFERENCES,
  getHomePreferences,
  saveHomePreferences,
  type BothContentPreference,
  type ContentOrientation,
  type HomePreferences,
} from "../config/homePreferences.ts";
import { openExternalUrl } from "../runtime/platform.ts";
import {
  createLocalProfile,
  getLocalProfiles,
  pinLengthError,
  readImageFileAsDataUrl,
  verifyPin,
  type LocalProfile,
} from "../utils/localProfiles.ts";
import mugiwaraSeekLogo from "../assets/mugiwara-seeklogo.png";
import ProfileBackdrop from "../components/profile/ProfileBackdrop.tsx";
import { useHideCursorOnGamepad } from "../hooks/useHideCursorOnGamepad.ts";
import QuickStartProfile, { registerPresetDataUrl, type ProfileFlowStage } from "../components/quickstart/QuickStartProfile.tsx";

/** Lado del avatar ya recortado antes de guardarlo en el perfil. */
const PRESET_AVATAR_SIZE = 384;

/**
 * Avatar por defecto (una de las mascotas) a data URL: recorte cuadrado al
 * centro y reencodeado. Las mascotas son PNG de ~1250px y 1 MB; guardarlas tal
 * cual engordaria cada perfil con mas de un megabyte de base64.
 */
async function readPresetAsDataUrl(src: string): Promise<string> {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  await image.decode();

  const size = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - size) / 2;
  const sy = (image.naturalHeight - size) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = PRESET_AVATAR_SIZE;
  canvas.height = PRESET_AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen.");
  context.drawImage(image, sx, sy, size, size, 0, 0, PRESET_AVATAR_SIZE, PRESET_AVATAR_SIZE);

  const webp = canvas.toDataURL("image/webp", 0.9);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/png");
}

type QuickStartStep = "profile" | "welcome" | "content" | "playback" | "apis" | "addons";

interface QuickStartProps {
  installedAddons: number;
  activeProfile: LocalProfile | null;
  defaultName?: string;
  useFreshDefaults?: boolean;
  profileOnly?: boolean;
  onComplete: (destination: "/home" | "/addons") => void;
  /** B / Esc en el nombre: se abandona la creación y se vuelve al selector. */
  onCancel?: () => void;
}

export default function QuickStart({ installedAddons, activeProfile, defaultName = "", useFreshDefaults = false, profileOnly = false, onComplete, onCancel }: QuickStartProps) {
  const [includeProfileStep] = useState(() => activeProfile === null);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<LocalProfile | null>(activeProfile);
  const [profileName, setProfileName] = useState(defaultName);
  const [profilePin, setProfilePin] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | undefined>();
  const [profileError, setProfileError] = useState("");
  const [creatingProfile, setCreatingProfile] = useState(false);
  // Sub-flujo del paso "profile": nombre -> imagen -> resumen -> bienvenida.
  const [profileStage, setProfileStage] = useState<ProfileFlowStage>("name");
  // El mando puede repetir el OK: un solo aviso de salida por pulsacion doble.
  const leavingProfileFlowRef = useRef(false);
  const [keys, setKeys] = useState<ApiKeys>(() => useFreshDefaults ? { ...EMPTY_API_KEYS } : getApiKeys());
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => useFreshDefaults ? { ...DEFAULT_PLAYBACK_PREFERENCES } : getPlaybackPreferences());
  const [homePreferences, setHomePreferences] = useState<HomePreferences>(() => useFreshDefaults
    ? { ...DEFAULT_HOME_PREFERENCES, catalogOrder: [], hiddenCatalogKeys: [] }
    : getHomePreferences());
  const steps: QuickStartStep[] = profileOnly
    ? ["profile"]
    : includeProfileStep
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
    const pinIssue = pinLengthError(profilePin);
    if (pinIssue) {
      setProfileError(pinIssue);
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
      // En /quick-start/profile no hay paso "welcome" detras: la bienvenida es
      // la ultima pantalla del sub-flujo y su CTA es quien sale (leaveProfileFlow).
      if (profileOnly) {
        setProfileStage("welcome");
        return;
      }
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

  /**
   * Mascota por defecto: el perfil solo admite data URLs, asi que la imagen se
   * recorta a un cuadrado de PRESET_AVATAR_SIZE y se codifica antes de guardarse.
   * Sin esto se meteria el PNG original (~1 MB) en el perfil de cada usuario.
   * WebP con alfa cuando el navegador lo trae; PNG como reserva.
   */
  async function choosePresetProfileImage(src: string) {
    try {
      const dataUrl = await readPresetAsDataUrl(src);
      registerPresetDataUrl(src, dataUrl);
      setProfileAvatar(dataUrl);
      setProfileError("");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "No se pudo cargar la imagen.");
    }
  }

  function clearProfileImage() {
    setProfileAvatar(undefined);
    setProfileError("");
  }

  function leaveProfileFlow() {
    if (leavingProfileFlowRef.current) return;
    leavingProfileFlowRef.current = true;
    if (profileOnly) {
      completeQuickStart();
      onComplete("/home");
      return;
    }
    setStep(current => Math.min(steps.length - 1, current + 1));
  }

  function finish(destination: "/home" | "/addons") {
    persistSelections();
    completeQuickStart();
    onComplete(destination);
  }

  async function continueToNextStep() {
    if (currentStep === "profile") {
      await createProfileAndContinue();
      return;
    }
    setStep(current => Math.min(steps.length - 1, current + 1));
  }

  async function skip() {
    if (!profile) return;
    persistSelections();
    completeQuickStart();
    onComplete(installedAddons > 0 ? "/home" : "/addons");
  }

  /**
   * Esta page es la misma identidad que Profiles (mismo fondo, mismo pad, mismo
   * teclado en pantalla), asi que enciende el mismo flag: con el, el motor
   * espacial global deja pasar las flechas y el mando recorre los controles por
   * geometria. Sin la clase, el teclado en pantalla no se puede usar con el
   * mando. No lleva CSS: es solo un flag de modo.
   */
  const isIdentityPage = currentStep === "profile" || currentStep === "welcome";
  useEffect(() => {
    if (!isIdentityPage) return;
    document.documentElement.classList.add("aetherio-profile-selection");
    return () => document.documentElement.classList.remove("aetherio-profile-selection");
  }, [isIdentityPage]);

  // Con el mando en la mano el cursor sobra (igual que en Profiles): se esconde
  // al moverlo y vuelve con el ratón o con una tecla real.
  useHideCursorOnGamepad();

  // El paso "profile" es una page completa con el fondo compartido de Profiles:
  // el sub-flujo (nombre, imagen, resumen, bienvenida) necesita toda la pantalla
  // y asi el passage de perfil a perfil no cambia de fondo.
  if (currentStep === "profile" || currentStep === "welcome") {
    const welcomeOnly = currentStep === "welcome";
    return (
      <div className="relative min-h-screen overflow-hidden text-white">
        <ProfileBackdrop imageUrl={profile?.avatarDataUrl ?? profileAvatar} />
        <QuickStartProfile
          stage={welcomeOnly ? "welcome" : profileStage}
          name={welcomeOnly ? profile?.name ?? profileName : profileName}
          pin={profilePin}
          avatarDataUrl={welcomeOnly ? profile?.avatarDataUrl : profileAvatar}
          error={profileError}
          busy={creatingProfile}
          onNameChange={setProfileName}
          onPinChange={setProfilePin}
          onStageChange={welcomeOnly ? () => {} : setProfileStage}
          onChooseImage={chooseProfileImage}
          onPickPreset={(src) => void choosePresetProfileImage(src)}
          onClearImage={clearProfileImage}
          onExit={onCancel ?? (() => undefined)}
          onSubmit={() => {
            if (welcomeOnly || profileStage === "welcome") {
              leaveProfileFlow();
              return;
            }
            void createProfileAndContinue();
          }}
        />
      </div>
    );
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
          {currentStep === "content" ? (
            <ContentStep
              orientation={homePreferences.contentOrientation}
              bothPreference={homePreferences.bothPreference}
              onChange={contentOrientation => setHomePreferences(current => ({ ...current, contentOrientation }))}
              onBothChange={bothPreference => setHomePreferences(current => ({ ...current, bothPreference }))}
            />
          ) : null}
          {currentStep === "playback" ? <PlaybackStep playback={playback} onChange={setPlayback} /> : null}
          {currentStep === "apis" ? (
            <ApiStep
              keys={keys}
              onChange={next => {
                setKeys(next);
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
              disabled={creatingProfile}
              className="gsap-transition flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-black disabled:opacity-55 hover:bg-white/82"
            >
              {creatingProfile ? "Creando perfil..." : "Continuar"}
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

function ContentStep({
  orientation,
  bothPreference,
  onChange,
  onBothChange,
}: {
  orientation: ContentOrientation;
  bothPreference: BothContentPreference;
  onChange: (value: ContentOrientation) => void;
  onBothChange: (value: BothContentPreference) => void;
}) {
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
        {orientation === "both" ? (
          <div className="rounded-[26px] border border-white/10 bg-white/[0.055] p-4">
            <p className="mb-3 px-1 text-sm font-black text-white/78">¿Con qué preferencia?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { value: "anime", label: "Anime" },
                  { value: "movies-series", label: "Series y películas" },
                ] as Array<{ value: BothContentPreference; label: string }>
              ).map(option => {
                const isSelected = bothPreference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onBothChange(option.value)}
                    className={clsx(
                      "gsap-transition rounded-full px-4 py-3 text-sm font-black",
                      isSelected ? "bg-white text-black" : "text-white/54 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 px-1 text-xs font-medium text-white/44">Si eliges Anime, los catálogos de anime se muestran primero y viceversa.</p>
          </div>
        ) : null}
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
  onChange,
}: {
  keys: ApiKeys;
  onChange: (next: ApiKeys) => void;
}) {
  const profilesWithKeys = useMemo(() => {
    const all = getLocalProfiles();
    return all.filter(p => {
      const k = getApiKeysForProfile(p.id);
      return k.animeSkipClientId;
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
        description="Anime Skip es opcional y ayuda a detectar intros y endings en anime."
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
                  <ProfileAvatar profile={p} className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white/20 text-[10px] font-black" />
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
              <ProfileAvatar profile={sharing.profile} className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/20 text-sm font-black" />
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
                maxLength={4}
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
