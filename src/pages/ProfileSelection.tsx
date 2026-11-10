import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import PinPad from "../components/pin/PinPad.tsx";
import ProfileBackdrop from "../components/profile/ProfileBackdrop.tsx";
import AddProfileIcon from "../components/ui/AddProfileIcon.tsx";
import {
  getLocalProfiles,
  getActiveProfileId,
  setActiveProfile,
  verifyPin,
  getProfileInitial,
  migratePinsToFourDigits,
  PIN_MIGRATION_EVENT,
  type LocalProfile,
} from "../utils/localProfiles.ts";
import { setBigPictureActive } from "../runtime/platform.ts";
import { getLastAppMode, setLastAppMode } from "../utils/appMode.ts";
import { getHomePreferences } from "../config/homePreferences.ts";
import { prefersReducedMotion } from "../utils/motion.ts";
import { GAMEPAD_ACTIVITY_EVENT } from "../hooks/useGamepad.ts";
import { holdCursorHidden, releaseCursorHidden } from "../hooks/useHiddenCursor.ts";
import packageJson from "../../package.json";
import "./ProfileSelection.css";

const PASTEL_COLORS = [
  "#f9a8d4",
  "#93c5fd",
  "#6ee7b7",
  "#fcd34d",
  "#c4b5fd",
  "#fda4af",
  "#67e8f9",
  "#a7f3d0",
];

type WelcomeMode = "first" | "return";

type WelcomeCopy = {
  mode: WelcomeMode;
  messageIndex: number;
};

const WELCOME_VERSION = packageJson.version || "dev";
const WELCOME_SESSION_COUNT_KEY = "aetherio-welcome-session-count-v1";
const WELCOME_VERSION_KEY = "aetherio-welcome-version-v1";
const WELCOME_FIRST_VARIANT_KEY = "aetherio-welcome-first-variant-v1";

const WELCOME_FIRST_MESSAGES = [
  "Bienvenido a Aetherio, {name}. Tus películas te esperan.",
  "Tu cine personal está listo, {name}.",
  "La próxima película puede empezar ya, {name}.",
  "Tu próxima serie te espera, {name}.",
  "Hay una nueva historia para ti, {name}.",
  "Tu biblioteca de películas y series está preparada, {name}.",
  "Todo listo para tu próxima sesión, {name}.",
  "Tu próxima aventura empieza aquí, {name}.",
  "La pantalla está lista, {name}.",
  "Tu selección de cine está en marcha, {name}.",
  "Tu noche de cine puede comenzar, {name}.",
  "Un nuevo mundo te espera en pantalla, {name}.",
  "Tu próxima historia está a punto de comenzar, {name}.",
  "Tu colección está en buenas manos, {name}.",
  "Ya puedes continuar donde estabas, {name}.",
  "Tu pantalla y tu biblioteca están listas, {name}.",
  "Hay algo nuevo para descubrir, {name}.",
  "Tu sesión de cine empieza ahora, {name}.",
  "Todo preparado para ver, {name}.",
  "Que empiece tu próxima historia, {name}.",
];

const WELCOME_RETURN_MESSAGES = [
  "Bienvenido de vuelta, {name}. Tus películas te esperaban.",
  "Tu cine personal sigue listo, {name}.",
  "¿Listo para otra película, {name}?",
  "Tu próxima serie sigue en marcha, {name}.",
  "Seguimos con tu historia, {name}.",
  "Tu biblioteca de películas y series sigue preparada, {name}.",
  "Todo listo para continuar, {name}.",
  "De vuelta al cine, {name}.",
  "Hay una nueva película para ti, {name}.",
  "La pantalla te espera, {name}.",
  "Tu próxima sesión empieza aquí, {name}.",
  "Volvemos a ver algo especial, {name}.",
  "Tu selección sigue preparada, {name}.",
  "Una nueva historia te está esperando, {name}.",
  "Tu maratón de películas está listo, {name}.",
  "Tu cine vuelve a encenderse, {name}.",
  "Seguimos donde lo dejaste, {name}.",
  "Listo para otra noche de cine, {name}.",
  "Tu biblioteca sigue en marcha, {name}.",
  "Bienvenido de nuevo al cine, {name}.",
];

const WELCOME_ANIME_FIRST_MESSAGES = [
  "Bienvenido a Aetherio, {name}. Tu próximo anime te espera.",
  "Tus series de anime están listas, {name}.",
  "Tu próximo episodio está a punto de comenzar, {name}.",
  "El siguiente arco empieza aquí, {name}.",
  "Una nueva aventura anime te espera, {name}.",
  "Tu lista de anime está preparada, {name}.",
  "Tu maratón de anime está listo, {name}.",
  "Tus personajes favoritos te esperan, {name}.",
  "La siguiente temporada ya está cerca, {name}.",
  "Tu colección de anime está lista, {name}.",
  "Un nuevo mundo te espera, {name}.",
  "Tu próximo binge puede empezar, {name}.",
  "Tu saga favorita continúa aquí, {name}.",
  "La pantalla está lista para anime, {name}.",
  "Hay un nuevo episodio esperándote, {name}.",
  "Tu próximo arco te está esperando, {name}.",
  "Tu perfil anime está activo, {name}.",
  "Todo listo para ver anime, {name}.",
  "La aventura continúa, {name}.",
  "Tu anime te espera en Aetherio, {name}.",
];

const WELCOME_ANIME_RETURN_MESSAGES = [
  "Bienvenido de vuelta, {name}. Tu próximo anime te esperaba.",
  "Tus series de anime siguen listas, {name}.",
  "Tu próximo episodio continúa aquí, {name}.",
  "El siguiente arco te estaba esperando, {name}.",
  "Tu maratón de anime sigue preparado, {name}.",
  "Una nueva aventura anime te espera, {name}.",
  "Tu lista de anime continúa en marcha, {name}.",
  "Tus personajes favoritos siguen en pantalla, {name}.",
  "La siguiente temporada está cada vez más cerca, {name}.",
  "Tu colección de anime sigue lista, {name}.",
  "Un nuevo mundo te espera, {name}.",
  "Tu próximo binge puede continuar, {name}.",
  "Seguimos con tu saga, {name}.",
  "Todo listo para más anime, {name}.",
  "Tu próximo arco continúa, {name}.",
  "La aventura anime sigue aquí, {name}.",
  "Tu perfil anime está activo, {name}.",
  "Hay un nuevo episodio esperándote, {name}.",
  "La pantalla está lista para anime, {name}.",
  "Volvemos al anime, {name}.",
];

function readNumber(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveWelcomeCopy(): WelcomeCopy {
  if (typeof window === "undefined") return { mode: "first", messageIndex: 0 };

  try {
    const previousVersion = window.localStorage.getItem(WELCOME_VERSION_KEY);
    const sessionCount = readNumber(window.sessionStorage.getItem(WELCOME_SESSION_COUNT_KEY));
    const firstVisit = previousVersion !== WELCOME_VERSION || sessionCount === 0;
    const nextSessionCount = sessionCount + 1;
    const firstVariant = readNumber(window.localStorage.getItem(WELCOME_FIRST_VARIANT_KEY));
    const messageIndex = firstVisit
      ? firstVariant % WELCOME_FIRST_MESSAGES.length
      : Math.max(0, sessionCount - 1) % WELCOME_RETURN_MESSAGES.length;

    window.sessionStorage.setItem(WELCOME_SESSION_COUNT_KEY, String(nextSessionCount));
    window.localStorage.setItem(WELCOME_VERSION_KEY, WELCOME_VERSION);
    if (firstVisit) window.localStorage.setItem(WELCOME_FIRST_VARIANT_KEY, String(firstVariant + 1));

    return {
      mode: firstVisit ? "first" : "return",
      messageIndex,
    };
  } catch {
    return { mode: "first", messageIndex: 0 };
  }
}

function formatWelcomeMessage(message: string, name: string) {
  return message.replace("{name}", name);
}

function getWelcomeMessage(profile: LocalProfile, copy: WelcomeCopy) {
  const preferences = getHomePreferences();
  const prefersAnime = preferences.contentOrientation === "anime"
    || (preferences.contentOrientation === "both" && preferences.bothPreference === "anime");
  const messages = prefersAnime
    ? copy.mode === "first" ? WELCOME_ANIME_FIRST_MESSAGES : WELCOME_ANIME_RETURN_MESSAGES
    : copy.mode === "first" ? WELCOME_FIRST_MESSAGES : WELCOME_RETURN_MESSAGES;
  return formatWelcomeMessage(messages[copy.messageIndex % messages.length], profile.name);
}

interface ProfileSelectionProps {
  onProfileSelected?: (
    profile: LocalProfile,
    onProgress: (progress: number, label: string) => void,
  ) => Promise<void>;
}

// Motivo propio de esta pantalla en el contador de cursor oculto de
// useHiddenCursor: no se pisa con Big Picture ni con Quick Start.
const CURSOR_REASON = "profile-selection";

export default function ProfileSelection({ onProfileSelected }: ProfileSelectionProps) {
  const location = useLocation();
  const navigate = useNavigate();
  // En esta page el modo lo decide el dispositivo de entrada, no la ruta: mover
  // el mando = Big Picture (y el cursor se esconde), mover el ratón o pulsar el
  // teclado = modo normal. Antes de la primera señal manda el modo restaurado.
  const [modeOverride, setModeOverride] = useState<boolean | null>(null);
  const bigPicture = modeOverride !== null
    ? modeOverride
    : location.pathname.startsWith("/big-picture")
      || new URLSearchParams(location.search).get("from") === "big-picture"
      || getLastAppMode() === "big-picture";
  // Los perfiles se releen cuando la migración de PINs los toca (los liberar
  // cambia `pin` y `updatedAt` de la lista guardada).
  const [profilesVersion, setProfilesVersion] = useState(0);
  const profiles = useMemo(() => getLocalProfiles(), [profilesVersion]);
  const [welcomeCopy, setWelcomeCopy] = useState<WelcomeCopy>({ mode: "first", messageIndex: 0 });
  const welcomeCopyResolvedRef = useRef(false);
  const [pinModal, setPinModal] = useState<{ profile: LocalProfile; pin: string; error: string } | null>(null);
  // El passcode no es un overlay: sustituye en el sitio a las burbujas y al
  // titulo. Estos dos refs son las dos caras del intercambio y `showPin` decide
  // cuál está montada mientras dura la transición.
  const [showPin, setShowPin] = useState(false);
  const gridViewRef = useRef<HTMLDivElement>(null);
  const pinViewRef = useRef<HTMLDivElement>(null);
  // Un solo cierre por apertura: el mando puede repetir B durante los ~180ms
  // del fade y el intercambio no debe reproducirse dos veces.
  const closingPinRef = useRef(false);
  // Burbuja desde la que se abrió el passcode: al cerrar, el foco vuelve ahí y
  // no al primer perfil de la lista.
  const pinReturnIdRef = useRef<string | null>(null);
  const pinWasOpenRef = useRef(false);
  const profileCardRefs = useRef(new Map<string, HTMLButtonElement>());
  // Burbuja de "Agregar": es de donde se entra a crear un perfil, asi que al
  // volver con B desde Quick Start el foco vuelve a ella y no al primer perfil.
  const addCardRef = useRef<HTMLButtonElement>(null);
  const focusAddRef = useRef((location.state as { focusAdd?: boolean } | null)?.focusAdd === true);
  const [adding, setAdding] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [welcomeProfile, setWelcomeProfile] = useState<LocalProfile | null>(null);
  const [profileProgress, setProfileProgress] = useState(0);
  const [profileProgressLabel, setProfileProgressLabel] = useState("Preparando tu biblioteca…");
  const firstControlRef = useRef<HTMLButtonElement>(null);

  const hasActive = !!getActiveProfileId();
  const bgProfile = profiles.find(p => p.id === getActiveProfileId()) || profiles[0];

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // PINs legacy (5-8 dígitos) liberados por la migración: se avisa una vez.
  const [releasedPins, setReleasedPins] = useState<string[]>([]);
  const targetUrl = hoveredId
    ? profiles.find(p => p.id === hoveredId)?.avatarDataUrl
    : bgProfile?.avatarDataUrl;

  const [bgCurrent, setBgCurrent] = useState<string | null | undefined>(bgProfile?.avatarDataUrl);
  const [bgNext, setBgNext] = useState<string | null | undefined>(null);
  const [bgTransitioning, setBgTransitioning] = useState(false);
  const bgTimer = useRef<number>(0);

  useEffect(() => {
    // La migración quita los PINs que ya no son de 4 dígitos (main.tsx la
    // lanza al arrancar). Si liberó alguno, se lo decimos aquí.
    let cancelled = false;
    void migratePinsToFourDigits().then(released => {
      if (!cancelled && released.length > 0) {
        setReleasedPins(released);
        setProfilesVersion(version => version + 1);
      }
    });
    const onMigrated = (event: Event) => {
      const detail = (event as CustomEvent<{ released?: string[] }>).detail;
      if (cancelled || !detail?.released?.length) return;
      setReleasedPins(detail.released);
      setProfilesVersion(version => version + 1);
    };
    window.addEventListener(PIN_MIGRATION_EVENT, onMigrated);
    return () => {
      cancelled = true;
      window.removeEventListener(PIN_MIGRATION_EVENT, onMigrated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("aetherio-profile-selection");
    return () => document.documentElement.classList.remove("aetherio-profile-selection");
  }, []);

  useEffect(() => {
    if (welcomeCopyResolvedRef.current) return;
    welcomeCopyResolvedRef.current = true;
    setWelcomeCopy(resolveWelcomeCopy());
  }, []);

  useEffect(() => {
    if (!bigPicture) return;
    setBigPictureActive(true);
    return () => setBigPictureActive(false);
  }, [bigPicture]);

  // §El mando manda: al moverlo esta page entra en Big Picture y esconde el
  // cursor; al mover el ratón o pulsar una tecla real vuelve al modo normal y
  // enseña el cursor.
  //
  // Aquí NO se persiste el modo. A diferencia de antes, escribir aquí lo
  // grababa para toda la app y lo hacía antes de saber qué perfil se iba a
  // elegir: el ratón se movía al apuntar una tarjeta y machacaba el modo que
  // el usuario había dejado en el perfil 1. Ahora el modo se persiste en
  // `enterProfile`, cuando ya hay un dueño al que atribuírselo, y esto solo
  // decide cómo se ve esta pantalla.
  useEffect(() => {
    // Evita un write a state por cada mousemove: solo al cambiar de modo.
    const modeRef = { current: null as boolean | null };

    const applyMode = (next: boolean) => {
      if (modeRef.current === next) return;
      modeRef.current = next;
      if (next) holdCursorHidden(CURSOR_REASON);
      else releaseCursorHidden(CURSOR_REASON);
      setModeOverride(next);
    };

    const onGamepad = () => applyMode(true);
    const onNormalInput = () => applyMode(false);
    const onKey = (event: KeyboardEvent) => {
      // El hook del mando sintetiza flechas/Enter/Escape con `new KeyboardEvent`
      // (isTrusted = false). Si las contáramos, mover el stick nos devolvería
      // al instante al modo normal: solo el teclado real cambia de modo.
      if (!event.isTrusted) return;
      onNormalInput();
    };

    window.addEventListener(GAMEPAD_ACTIVITY_EVENT, onGamepad);
    window.addEventListener("mousemove", onNormalInput, { passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(GAMEPAD_ACTIVITY_EVENT, onGamepad);
      window.removeEventListener("mousemove", onNormalInput);
      window.removeEventListener("keydown", onKey, true);
      if (modeRef.current === true) releaseCursorHidden(CURSOR_REASON);
    };
  }, []);

  useEffect(() => {
    if (pinModal) return;
    let timer = 0;
    const focusWhenVisible = () => {
      // Tras cerrar el passcode el foco vuelve a la burbuja desde la que se
      // abrió; si no, al primer control, como al entrar en la page. Llegando
      // desde Quick Start (B en el nombre) el foco va a "Agregar".
      const wantsAdd = focusAddRef.current;
      focusAddRef.current = false;
      const target = wantsAdd
        ? addCardRef.current ?? firstControlRef.current
        : (pinReturnIdRef.current ? profileCardRefs.current.get(pinReturnIdRef.current) : null)
          ?? firstControlRef.current;
      if (!target) return;
      const style = window.getComputedStyle(target);
      if (style.visibility !== "visible" || style.display === "none") {
        timer = window.setTimeout(focusWhenVisible, 100);
        return;
      }
      target.focus({ preventScroll: true });
    };
    timer = window.setTimeout(focusWhenVisible, 40);
    return () => window.clearTimeout(timer);
  }, [pinModal]);

  /**
   * Vuelta al selector: las burbujas entran con fade. Va en un efecto y no al
   * final de closePin porque al closing la grilla todavia no esta montada
   * (showPin la sustituye), asi que alli el ref apuntaba a null y el fade se
   * perdia.
   */
  useEffect(() => {
    if (showPin || !pinWasOpenRef.current) return;
    pinWasOpenRef.current = false;
    const grid = gridViewRef.current;
    if (!grid || prefersReducedMotion()) return;
    gsap.fromTo(
      grid,
      { opacity: 0 },
      { opacity: 1, duration: 0.34, ease: "power3.out", clearProps: "opacity" },
    );
    return () => {
      gsap.killTweensOf(grid);
      gsap.set(grid, { clearProps: "opacity" });
    };
  }, [showPin]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      // Con el passcode abierto, B / Esc deshacen el intercambio entero
      // (closePin): el pad se va y vuelven las burbujas. Con un
      // `setPinModal(null)` pelado el pad se queda montado y vacio — se ve
      // como si el B no hiciese nada — y ademas el preventDefault de aqui
      // evita que el back global de la page saque de /profiles.
      if (pinModal) void closePin();
      else navigate(-1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [bigPicture, navigate, pinModal]);

  const startBgTransition = useCallback((url: string | null | undefined) => {
    if (!url || url === bgCurrent || url === bgNext) return;
    window.clearTimeout(bgTimer.current);
    setBgNext(url);
    setBgTransitioning(true);
    bgTimer.current = window.setTimeout(() => {
      setBgCurrent(url);
      setBgNext(null);
      setBgTransitioning(false);
    }, 400);
  }, [bgCurrent, bgNext]);

  useEffect(() => {
    startBgTransition(targetUrl);
    return () => window.clearTimeout(bgTimer.current);
  }, [targetUrl, startBgTransition]);

  useEffect(() => {
    if (!hasActive && profiles.length === 1) {
      setActiveProfile(profiles[0].id);
      navigate(bigPicture ? "/big-picture" : "/home", { replace: true, state: { freshEntrance: true } });
    }
  }, [bigPicture, hasActive, navigate, profiles]);

  useEffect(() => {
    if (!welcomeProfile) {
      setProfileProgress(0);
      setProfileProgressLabel("Preparando tu biblioteca…");
    }
  }, [welcomeProfile]);

  function selectProfile(profile: LocalProfile) {
    if (profile.pin) {
      void openPin(profile);
      return;
    }
    void enterProfile(profile);
  }

  /**
   * Intercambio: las burbujas y "¿Quién está viendo?" se van (fade) y en su
   * lugar entra el passcode. Sin overlay ni blur: la page es la misma, solo
   * cambia lo que hay en el centro. Las transiciones de esta page son fades
   * puros — nada de escala ni desplazamiento.
   */
  async function openPin(profile: LocalProfile) {
    closingPinRef.current = false;
    pinReturnIdRef.current = profile.id;
    const grid = gridViewRef.current;
    if (grid && !prefersReducedMotion()) {
      await gsap.to(grid, { opacity: 0, duration: 0.2, ease: "power2.in" });
    }
    setPinModal({ profile, pin: "", error: "" });
    setShowPin(true);
    pinWasOpenRef.current = true;
  }

  async function closePin() {
    if (closingPinRef.current) return;
    closingPinRef.current = true;
    const pad = pinViewRef.current;
    if (pad && !prefersReducedMotion()) {
      await gsap.to(pad, { opacity: 0, duration: 0.18, ease: "power2.in" });
    }
    setShowPin(false);
    setPinModal(null);
  }

  /** Entrada del passcode: fade, como el resto de transiciones de la page. */
  useEffect(() => {
    if (!showPin) return;
    const pad = pinViewRef.current;
    if (!pad || prefersReducedMotion()) return;
    gsap.fromTo(
      pad,
      { opacity: 0 },
      { opacity: 1, duration: 0.34, ease: "power3.out", clearProps: "opacity" },
    );
    return () => {
      gsap.killTweensOf(pad);
      gsap.set(pad, { clearProps: "opacity" });
    };
  }, [showPin]);

  async function enterProfile(profile: LocalProfile) {
    if (selectingId || welcomeProfile) return;
    setSelectingId(profile.id);
    setActiveProfile(profile.id);
    // El modo se resuelve AQUI, cuando ya se sabe que perfil entra. Antes se
    // resolvia antes de elegir, contra un valor global: por eso entrar en el
    // perfil 2 arrastraba el modo que habia dejado el perfil 1.
    //
    // El modo del perfil manda. El dispositivo (mando / ratón) solo decide
    // cuando el perfil entra por primera vez y no hay nada que recordar, y
    // `?from=big-picture` manda sobre un perfil recien creado desde Big Picture.
    const remembered = getLastAppMode(profile.id);
    const fromBigPicture = new URLSearchParams(location.search).get("from") === "big-picture";
    const nextMode = remembered ?? (fromBigPicture || modeOverride === true ? "big-picture" : "normal");
    setLastAppMode(nextMode, profile.id);
    setWelcomeProfile(profile);
    setProfileProgress(0);
    setProfileProgressLabel("Preparando tu perfil…");
    try {
      await onProfileSelected?.(profile, (progress, label) => {
        setProfileProgress(Math.max(0, Math.min(99, progress)));
        setProfileProgressLabel(label);
      });
    } finally {
      setProfileProgress(100);
      setProfileProgressLabel("Listo");
      await new Promise(resolve => window.setTimeout(resolve, 180));
      navigate(nextMode === "big-picture" ? "/big-picture" : "/home", { replace: true, state: { freshEntrance: true } });
    }
  }

  async function submitPin() {
    if (!pinModal) return;
    const valid = await verifyPin(pinModal.pin, pinModal.profile.pin!);
    if (!valid) {
      setPinModal(prev => prev ? { ...prev, pin: "", error: "PIN incorrecto" } : null);
      return;
    }
    const profile = pinModal.profile;
    // El passcode se va por el mismo intercambio y entra el perfil.
    const pad = pinViewRef.current;
    if (pad && !prefersReducedMotion()) {
      await gsap.to(pad, { opacity: 0, duration: 0.18, ease: "power2.in" });
    }
    setShowPin(false);
    setPinModal(null);
    void enterProfile(profile);
  }

  function addProfile() {
    setAdding(true);
    navigate(bigPicture ? "/quick-start/profile?from=big-picture" : "/quick-start/profile");
  }

  return (
    <div className={`profile-selection-page${welcomeProfile ? " profile-selection-page--welcoming" : ""}`} data-bp-profile-selection={bigPicture ? "true" : undefined}>
      <ProfileBackdrop
        imageUrl={bgCurrent}
        nextImageUrl={bgNext}
        transitioning={bgTransitioning}
      />

      {welcomeProfile ? (
        <main className="profile-selection-content profile-welcome-content" aria-live="polite">
           <h1 className="profile-selection-title profile-welcome-title">
             {getWelcomeMessage(welcomeProfile, welcomeCopy)}
           </h1>
            <div className="profile-preparing" role="status" aria-label="Preparando tu biblioteca">
              <div
                className="profile-preparing-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(profileProgress)}
              >
                <span style={{ width: `${profileProgress}%` }} />
              </div>
              <p>{profileProgressLabel}</p>
            </div>
         </main>
      ) : (
        <main className="profile-selection-content">
          {showPin ? (
            <div
              ref={pinViewRef}
              className="profile-selection-pin"
              // Zona modal en los dos modos: el motor espacial no debe saltar a
              // las cards que quedan detrás mientras se escribe el PIN.
              data-spatial-modal="true"
            >
              <PinPad
                value={pinModal?.pin ?? ""}
                onChange={pin => setPinModal(prev => (prev ? { ...prev, pin, error: "" } : null))}
                onComplete={() => void submitPin()}
                onCancel={() => void closePin()}
                error={pinModal?.error ?? ""}
              />
            </div>
          ) : (
            <div ref={gridViewRef}>
              <h1 className="profile-selection-title">
                ¿Quién está viendo?
              </h1>

              {releasedPins.length > 0 ? (
                <p className="profile-selection-note">
                  Le quitamos el PIN a {releasedPins.join(", ")}: el PIN ahora es de 4 dígitos y el
                  anterior no se podía introducir. Ya podés entrar y poner uno nuevo en Ajustes.
                </p>
              ) : null}

          <div className="profile-selection-row">
            {profiles.map((profile, index) => (
              <button
                key={profile.id}
                ref={node => {
                  if (!node) {
                    profileCardRefs.current.delete(profile.id);
                    return;
                  }
                  profileCardRefs.current.set(profile.id, node);
                  if (index === 0) firstControlRef.current = node;
                }}
                onClick={() => selectProfile(profile)}
                disabled={selectingId !== null}
                onMouseEnter={() => setHoveredId(profile.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(profile.id)}
                onBlur={() => setHoveredId(null)}
                className={`profile-card ${selectingId === profile.id ? "profile-card-selecting" : ""}`}
              >
                <div
                  className="profile-card-avatar"
                  style={{
                    backgroundColor: PASTEL_COLORS[index % PASTEL_COLORS.length],
                  }}
                >
                  {profile.avatarDataUrl ? (
                    <img src={profile.avatarDataUrl} alt="" />
                  ) : (
                    <span>{getProfileInitial(profile)}</span>
                  )}
                </div>
                <span className="profile-card-name">
                  {profile.name}
                </span>
              </button>
            ))}

            <button
              ref={node => {
                addCardRef.current = node;
                if (profiles.length === 0 && node) firstControlRef.current = node;
              }}
              onClick={addProfile}
              disabled={adding || selectingId !== null}
              className="profile-card profile-card-add"
            >
              <div className="profile-card-avatar">
                <AddProfileIcon />
              </div>
              <span className="profile-card-name">Agregar</span>
            </button>
          </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
