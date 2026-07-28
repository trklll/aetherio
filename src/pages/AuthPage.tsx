import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, HardDrive, LockKeyhole, Mail, UserRound } from "lucide-react";
import aetherioLogo from "../assets/aetheriologo.png";
import aniListLogo from "../assets/logoauth/anilist_logo_icon_247617.png";
import googleLogo from "../assets/logoauth/Google__G__logo.svg.png";
import { gsap } from "../utils/motion";
import {
  continueLocally,
  getOAuthProviders,
  loginAccount,
  registerAccount,
  startSocialLogin,
  type AetherioUser,
  type OAuthProvider,
} from "../auth/authClient";
import "./AuthPage.css";

export default function AuthPage({
  initialError = "",
  onAuthenticated,
  onContinueLocal,
}: {
  initialError?: string;
  onAuthenticated: (user: AetherioUser) => void;
  onContinueLocal: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState<OAuthProvider | null>(null);
  const [providers, setProviders] = useState<Record<OAuthProvider, boolean> | null>(null);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  useEffect(() => {
    void getOAuthProviders()
      .then(setProviders)
      .catch(() => setProviders(null));
  }, []);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        ".auth-card",
        { opacity: 0, y: 28, scale: 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: 0.72, ease: "power3.out" },
      );
      gsap.fromTo(
        ".auth-reveal",
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.55, stagger: 0.055, delay: 0.18, ease: "power3.out" },
      );
      gsap.to(".auth-orb--one", {
        x: 38,
        y: -24,
        duration: 8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to(".auth-orb--two", {
        x: -34,
        y: 22,
        duration: 10,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
    }, rootRef);
    return () => context.revert();
  }, [mode]);

  function switchMode(next: "login" | "register") {
    if (busy || next === mode) return;
    setMode(next);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const user = mode === "register"
        ? await registerAccount({ displayName, email, password })
        : await loginAccount(email, password);
      onAuthenticated(user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo iniciar sesión.");
      requestAnimationFrame(() => {
        gsap.fromTo(".auth-error", { x: -8 }, { x: 0, duration: 0.35, ease: "elastic.out(1, 0.45)" });
      });
    } finally {
      setBusy(false);
    }
  }

  function animateButton(target: HTMLElement, active: boolean) {
    gsap.to(target, {
      y: active ? -2 : 0,
      scale: active ? 1.012 : 1,
      duration: 0.2,
      ease: "power2.out",
      overwrite: true,
    });
  }

  async function startSocial(provider: OAuthProvider) {
    if (providers && !providers[provider]) {
      const label = provider === "google" ? "Google" : "AniList";
      setError(`${label} todavía necesita sus credenciales OAuth.`);
      return;
    }
    setSocialBusy(provider);
    setError("");
    try {
      await startSocialLogin(provider);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir el proveedor.");
      setSocialBusy(null);
    }
  }

  async function enterLocalMode() {
    await continueLocally();
    onContinueLocal();
  }

  return (
    <main ref={rootRef} className="auth-page">
      <div className="auth-ambient" aria-hidden="true">
        <div className="auth-orb auth-orb--one" />
        <div className="auth-orb auth-orb--two" />
        <div className="auth-grid" />
      </div>

      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand auth-reveal">
          <img src={aetherioLogo} alt="" />
          <div>
            <strong>Aetherio</strong>
            <span>Tu espacio para ver</span>
          </div>
        </div>

        <div className="auth-copy auth-reveal">
          <span className="auth-kicker">{mode === "login" ? "BIENVENIDO DE NUEVO" : "CREA TU CUENTA"}</span>
          <h1 id="auth-title">{mode === "login" ? "Entra a Aetherio." : "Todo empieza aquí."}</h1>
          <p>
            {mode === "login"
              ? "Accede a tu biblioteca y continúa desde donde lo dejaste."
              : "Una sola cuenta para entrar a Aetherio y conservar tu identidad."}
          </p>
        </div>

        <div className="auth-tabs auth-reveal" role="tablist" aria-label="Modo de acceso">
          <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => switchMode("login")}>
            Iniciar sesión
          </button>
          <button type="button" className={mode === "register" ? "is-active" : ""} onClick={() => switchMode("register")}>
            Crear cuenta
          </button>
        </div>

        <div className="auth-social auth-reveal">
          <button type="button" onClick={() => void startSocial("google")} disabled={socialBusy !== null}>
            <img className="auth-provider-logo" src={googleLogo} alt="" aria-hidden="true" />
            <span>{socialBusy === "google" ? "Abriendo Google…" : "Continuar con Google"}</span>
          </button>
          <button type="button" onClick={() => void startSocial("anilist")} disabled={socialBusy !== null}>
            <img
              className="auth-provider-logo auth-provider-logo--anilist"
              src={aniListLogo}
              alt=""
              aria-hidden="true"
            />
            <span>{socialBusy === "anilist" ? "Abriendo AniList…" : "Continuar con AniList"}</span>
          </button>
        </div>

        <div className="auth-divider auth-reveal"><span>o usa tu correo</span></div>

        <form onSubmit={submit}>
          {mode === "register" ? (
            <label className="auth-field auth-reveal">
              <span>Nombre</span>
              <div>
                <UserRound size={18} />
                <input
                  autoComplete="name"
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  placeholder="Cómo quieres que te llamemos"
                  minLength={2}
                  maxLength={50}
                  required
                />
              </div>
            </label>
          ) : null}

          <label className="auth-field auth-reveal">
            <span>Correo</span>
            <div>
              <Mail size={18} />
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="tu@correo.com"
                required
              />
            </div>
          </label>

          <label className="auth-field auth-reveal">
            <span>Contraseña</span>
            <div>
              <LockKeyhole size={18} />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder={mode === "register" ? "Mínimo 10 caracteres" : "Tu contraseña"}
                minLength={10}
                maxLength={128}
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(current => !current)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {error ? <p className="auth-error" role="alert">{error}</p> : null}

          <button
            type="submit"
            className="auth-submit auth-reveal"
            disabled={busy}
            onMouseEnter={event => animateButton(event.currentTarget, true)}
            onMouseLeave={event => animateButton(event.currentTarget, false)}
          >
            <span>{busy ? "Conectando…" : mode === "login" ? "Entrar a Aetherio" : "Crear mi cuenta"}</span>
            {!busy ? <ArrowRight size={19} /> : <i aria-hidden="true" />}
          </button>
        </form>

        <button type="button" className="auth-local auth-reveal" onClick={enterLocalMode}>
          <HardDrive size={17} />
          <span>
            <strong>Continuar localmente</strong>
            <small>Sin cuenta y conservando los perfiles de este dispositivo</small>
          </span>
          <ArrowRight size={17} />
        </button>

        <p className="auth-footnote auth-reveal">
          Puedes conectar una cuenta más adelante desde Ajustes.
        </p>
      </section>
    </main>
  );
}
