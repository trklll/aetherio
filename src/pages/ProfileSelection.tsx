import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Lock, Check } from "lucide-react";
import ProfileAvatar from "../components/profile/ProfileAvatar.tsx";
import AddProfileIcon from "../components/ui/AddProfileIcon.tsx";
import {
  getLocalProfiles,
  getActiveProfileId,
  setActiveProfile,
  verifyPin,
  getProfileInitial,
  type LocalProfile,
} from "../utils/localProfiles.ts";
import { setBigPictureActive } from "../runtime/platform.ts";
import { getLastAppMode, setLastAppMode } from "../utils/appMode.ts";
import { getHomePreferences } from "../config/homePreferences.ts";
import { GAMEPAD_ACTIVITY_EVENT } from "../hooks/useGamepad.ts";
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
  const profiles = useMemo(() => getLocalProfiles(), []);
  const [welcomeCopy, setWelcomeCopy] = useState<WelcomeCopy>({ mode: "first", messageIndex: 0 });
  const welcomeCopyResolvedRef = useRef(false);
  const [pinModal, setPinModal] = useState<{ profile: LocalProfile; pin: string; error: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [welcomeProfile, setWelcomeProfile] = useState<LocalProfile | null>(null);
  const [profileProgress, setProfileProgress] = useState(0);
  const [profileProgressLabel, setProfileProgressLabel] = useState("Preparando tu biblioteca…");
  const pinInputRef = useRef<HTMLInputElement>(null);
  const firstControlRef = useRef<HTMLButtonElement>(null);

  const hasActive = !!getActiveProfileId();
  const bgProfile = profiles.find(p => p.id === getActiveProfileId()) || profiles[0];

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const targetUrl = hoveredId
    ? profiles.find(p => p.id === hoveredId)?.avatarDataUrl
    : bgProfile?.avatarDataUrl;

  const [bgCurrent, setBgCurrent] = useState<string | null | undefined>(bgProfile?.avatarDataUrl);
  const [bgNext, setBgNext] = useState<string | null | undefined>(null);
  const [bgTransitioning, setBgTransitioning] = useState(false);
  const bgTimer = useRef<number>(0);

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
  // enseña el cursor. El último modo queda persistido para que al elegir
  // perfil se entre directamente en /big-picture o /home.
  useEffect(() => {
    const root = document.documentElement;
    // Evita un write a localStorage por cada mousemove: solo al cambiar de modo.
    const modeRef = { current: null as boolean | null };

    const applyMode = (next: boolean) => {
      if (modeRef.current === next) return;
      modeRef.current = next;
      setModeOverride(next);
      setLastAppMode(next ? "big-picture" : "normal");
    };

    const onGamepad = () => {
      root.classList.add("aetherio-bp-hide-cursor");
      applyMode(true);
    };
    const onNormalInput = () => {
      root.classList.remove("aetherio-bp-hide-cursor");
      applyMode(false);
    };
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
      root.classList.remove("aetherio-bp-hide-cursor");
    };
  }, []);

  useEffect(() => {
    if (pinModal) return;
    let timer = 0;
    const focusWhenVisible = () => {
      const control = firstControlRef.current;
      if (!control) return;
      const style = window.getComputedStyle(control);
      if (style.visibility !== "visible" || style.display === "none") {
        timer = window.setTimeout(focusWhenVisible, 100);
        return;
      }
      control.focus({ preventScroll: true });
    };
    timer = window.setTimeout(focusWhenVisible, 40);
    return () => window.clearTimeout(timer);
  }, [pinModal]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (pinModal) setPinModal(null);
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
    if (pinModal) pinInputRef.current?.focus();
  }, [pinModal]);

  useEffect(() => {
    if (!welcomeProfile) {
      setProfileProgress(0);
      setProfileProgressLabel("Preparando tu biblioteca…");
    }
  }, [welcomeProfile]);

  function selectProfile(profile: LocalProfile) {
    if (profile.pin) {
      setPinModal({ profile, pin: "", error: "" });
      return;
    }
    void enterProfile(profile);
  }

  async function enterProfile(profile: LocalProfile) {
    if (selectingId || welcomeProfile) return;
    setSelectingId(profile.id);
    setActiveProfile(profile.id);
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
      navigate(bigPicture ? "/big-picture" : "/home", { replace: true, state: { freshEntrance: true } });
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
    setPinModal(null);
    enterProfile(profile);
  }

  function addProfile() {
    setAdding(true);
    navigate(bigPicture ? "/quick-start/profile?from=big-picture" : "/quick-start/profile");
  }

  return (
    <div className={`profile-selection-page${welcomeProfile ? " profile-selection-page--welcoming" : ""}`} data-bp-profile-selection={bigPicture ? "true" : undefined}>
      <div className="profile-selection-bg">
        {bgCurrent && (
          <img
            src={bgCurrent}
            alt=""
            className={`profile-selection-bg-img ${bgTransitioning ? "bg-img-leave" : "bg-img-current"}`}
          />
        )}
        {bgNext && (
          <img
            src={bgNext}
            alt=""
            className={`profile-selection-bg-img bg-img-enter`}
          />
        )}
        <div className="profile-selection-bg-tint" />
        <div className="profile-selection-bg-radial" />
        <div className="profile-selection-bg-vertical" />
        <div className="profile-selection-bg-bottom" />
      </div>

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
          <h1 className="profile-selection-title">
            ¿Quién está viendo?
          </h1>

          <div className="profile-selection-row">
            {profiles.map((profile, index) => (
              <button
                key={profile.id}
                ref={index === 0 ? firstControlRef : undefined}
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
              ref={profiles.length === 0 ? firstControlRef : undefined}
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
        </main>
      )}

      {pinModal ? (
        <div
          className="pin-modal-overlay"
          data-spatial-modal={bigPicture ? "true" : undefined}
          onClick={() => setPinModal(null)}
        >
          <div
            className="pin-modal"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === "Escape") setPinModal(null); }}
          >
            <div className="pin-modal-profile">
              <ProfileAvatar
                profile={pinModal.profile}
                className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-white text-2xl font-black text-black"
              />
              <p className="pin-modal-name">{pinModal.profile.name}</p>
              <p className="pin-modal-hint">Introduce el PIN para acceder</p>
            </div>

            <div className="pin-input-wrapper">
              <Lock size={20} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
              <input
                ref={pinInputRef}
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinModal.pin}
                onChange={e =>
                  setPinModal(prev =>
                    prev ? { ...prev, pin: e.target.value.replace(/\D/g, ""), error: "" } : null
                  )
                }
                onKeyDown={e => { if (e.key === "Enter") void submitPin(); }}
                placeholder="PIN"
              />
            </div>

            {pinModal.error ? (
              <p className="pin-error">{pinModal.error}</p>
            ) : null}

            <div className="pin-actions">
              <button
                onClick={() => setPinModal(null)}
                className="pin-btn pin-btn-cancel"
              >
                Cancelar
              </button>
              <button
                onClick={() => void submitPin()}
                disabled={!pinModal.pin.trim()}
                className="pin-btn pin-btn-enter"
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Check size={16} />
                  Entrar
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
