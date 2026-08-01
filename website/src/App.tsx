import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  CirclePlay,
  GitFork,
  Layers3,
  MonitorPlay,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  downloadUrl: string;
  size: number;
}

const REPOSITORY_URL = "https://github.com/trklll/aetherio";
const WINDOWS_DOWNLOAD_URL = "/download/windows";

const SCREENSHOTS = [
  { src: "/screenshot_home.png", alt: "Pantalla principal de Aetherio" },
  { src: "/screenshot-profiles.jpg", alt: "Selección de perfiles de usuario" },
  { src: "/screenshot-detail_movie.jpg", alt: "Detalle de película en Aetherio" },
  { src: "/screenshot-detail_series.jpg", alt: "Detalle de serie en Aetherio" },
  { src: "/screenshot-episodes.png", alt: "Episodios, tráilers y reparto" },
];

function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [releaseError, setReleaseError] = useState(false);

  useEffect(() => {
    void fetch("/api/release")
      .then(async response => {
        if (!response.ok) throw new Error(`Release request failed: ${response.status}`);
        return response.json() as Promise<ReleaseInfo>;
      })
      .then(setRelease)
      .catch(() => setReleaseError(true));
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      gsap.set(root.querySelectorAll("[data-reveal], [data-hero-reveal]"), { opacity: 1, y: 0 });
      return;
    }

    const context = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(".site-header", { opacity: 0, y: -18 }, { opacity: 1, y: 0, duration: 0.7 })
        .fromTo(
          "[data-hero-reveal]",
          { opacity: 0, y: 28 },
          { opacity: 1, y: 0, duration: 0.75, stagger: 0.09 },
          "-=0.42",
        )
        .fromTo(
          ".product-stage",
          { opacity: 0, y: 44, rotateX: 4 },
          { opacity: 1, y: 0, rotateX: 0, duration: 1.05 },
          "-=0.58",
        );

      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach(element => {
        gsap.fromTo(
          element,
          { opacity: 0, y: 34 },
          {
            opacity: 1,
            y: 0,
            duration: 0.78,
            ease: "power3.out",
            scrollTrigger: {
              trigger: element,
              start: "top 86%",
              once: true,
            },
          },
        );
      });

      gsap.to(".ambient-orb--one", {
        x: 42,
        y: -28,
        duration: 8,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
      gsap.to(".ambient-orb--two", {
        x: -36,
        y: 24,
        duration: 10,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    }, root);

    return () => context.revert();
  }, []);

  function animateHover(event: MouseEvent<HTMLElement>, active: boolean) {
    gsap.to(event.currentTarget, {
      y: active ? -3 : 0,
      scale: active ? 1.015 : 1,
      duration: 0.22,
      ease: "power2.out",
      overwrite: true,
    });
  }

  return (
    <div ref={rootRef} className="site">
      <div className="ambient" aria-hidden="true">
        <div className="ambient-orb ambient-orb--one" />
        <div className="ambient-orb ambient-orb--two" />
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="Aetherio, inicio">
          <img src="/aetherio-logo.png" alt="" />
          <span>Aetherio</span>
        </a>
        <nav aria-label="Navegación principal">
          <a href="#experiencia">Experiencia</a>
          <a href="#abierto">Código abierto</a>
          <a href="#descargar">Descargar</a>
        </nav>
        <a className="nav-github" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          <GitFork size={17} />
          <span>GitHub</span>
        </a>
      </header>

      <main id="top">
        <section className="hero section-shell">
          <div className="hero-copy">
            <div className="eyebrow" data-hero-reveal>
              <span className="status-dot" />
              Open source · Windows
            </div>
            <h1 data-hero-reveal>
              Tu biblioteca.
              <br />
              <span>Tu forma de ver.</span>
            </h1>
            <p data-hero-reveal>
              Aetherio reúne películas, series y anime en una experiencia de escritorio rápida,
              personal y diseñada alrededor de tus propias fuentes.
            </p>
            <div className="hero-actions" data-hero-reveal>
              <a
                className="button button--primary"
                href={WINDOWS_DOWNLOAD_URL}
                onMouseEnter={event => animateHover(event, true)}
                onMouseLeave={event => animateHover(event, false)}
              >
                <ArrowDownToLine size={19} />
                Descargar para Windows
              </a>
              <a
                className="button button--quiet"
                href={REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                onMouseEnter={event => animateHover(event, true)}
                onMouseLeave={event => animateHover(event, false)}
              >
                Ver el código
                <ArrowRight size={18} />
              </a>
            </div>
            <div className="hero-meta" data-hero-reveal>
              <span><Check size={14} /> Instalador firmado</span>
              <span><Check size={14} /> Actualizaciones internas</span>
              <span><Check size={14} /> Sin anuncios</span>
            </div>
          </div>

          <ScreenshotCarousel />
        </section>

        <section id="experiencia" className="experience section-shell">
          <div className="section-intro" data-reveal>
            <span className="kicker">UNA SOLA EXPERIENCIA</span>
            <h2>Menos ruido. Más contenido.</h2>
            <p>
              La interfaz desaparece cuando no la necesitas y conserva lo importante donde esperas
              encontrarlo.
            </p>
          </div>

          <div className="feature-grid">
            <FeatureCard
              icon={<MonitorPlay />}
              title="Reproducción nativa"
              description="Reproduce directamente dentro de Aetherio con selección de audio, subtítulos y continuidad."
              className="feature-card--wide"
            />
            <FeatureCard
              icon={<Layers3 />}
              title="Tus fuentes"
              description="Combina add-ons y proveedores sin perder una experiencia consistente."
            />
            <FeatureCard
              icon={<UsersRound />}
              title="Perfiles personales"
              description="Historial, preferencias y progreso separados para cada perfil."
            />
            <FeatureCard
              icon={<RefreshCw />}
              title="Siempre al día"
              description="Aetherio avisa, descarga e instala nuevas versiones desde la propia aplicación."
              className="feature-card--wide feature-card--light"
            />
          </div>
        </section>

        <section id="abierto" className="open-source section-shell" data-reveal>
          <div className="open-source-copy">
            <div className="open-source-icon"><GitFork size={27} /></div>
            <span className="kicker">CONSTRUIDO EN ABIERTO</span>
            <h2>El código también es parte de la experiencia.</h2>
            <p>
              Aetherio permanece abierto para que puedas conocer cómo funciona, proponer mejoras y
              construir junto al proyecto.
            </p>
            <a
              className="text-link"
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              onMouseEnter={event => animateHover(event, true)}
              onMouseLeave={event => animateHover(event, false)}
            >
              Explorar en GitHub <ChevronRight size={18} />
            </a>
          </div>
          <div className="code-window" aria-label="Principios del proyecto">
            <div className="window-bar"><i /><i /><i /></div>
            <div className="code-lines">
              <span><b>01</b><em>abierto</em> por diseño</span>
              <span><b>02</b><em>local</em> por defecto</span>
              <span><b>03</b><em>tuyo</em> en cada detalle</span>
            </div>
          </div>
        </section>

        <section id="descargar" className="download section-shell" data-reveal>
          <div className="download-glow" aria-hidden="true" />
          <div className="download-icon"><CirclePlay size={36} /></div>
          <span className="kicker">AETHERIO PARA WINDOWS</span>
          <h2>Tu próxima reproducción empieza aquí.</h2>
          <p>
            {release
              ? `Versión ${release.version} · ${formatBytes(release.size)} · Publicada ${formatDate(release.publishedAt)}`
              : releaseError
                ? "La descarga sigue disponible aunque no podamos mostrar sus detalles."
                : "Buscando la versión más reciente…"}
          </p>
          <div className="download-actions">
            <a
              className="button button--primary button--large"
              href={WINDOWS_DOWNLOAD_URL}
              onMouseEnter={event => animateHover(event, true)}
              onMouseLeave={event => animateHover(event, false)}
            >
              <ArrowDownToLine size={20} />
              Descargar Aetherio
            </a>
            <span><ShieldCheck size={16} /> Windows 10/11 · 64 bits</span>
          </div>
        </section>
      </main>

      <footer className="footer section-shell">
        <a className="brand brand--footer" href="#top">
          <img src="/aetherio-logo.png" alt="" />
          <span>Aetherio</span>
        </a>
        <p>Hecho para quienes quieren decidir cómo ver.</p>
        <div>
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${REPOSITORY_URL}/releases`} target="_blank" rel="noreferrer">Releases</a>
        </div>
      </footer>
    </div>
  );
}

function ScreenshotCarousel() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrent(prev => (prev + 1) % SCREENSHOTS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="carousel-wrapper">
      <figure className="product-stage carousel" aria-label="Capturas de Aetherio">
        {SCREENSHOTS.map((shot, i) => (
          <img
            key={shot.src}
            src={shot.src}
            alt={shot.alt}
            aria-hidden={i !== current}
            className={`carousel-slide ${i === current ? "carousel-slide--active" : ""}`}
          />
        ))}
      </figure>
      <div className="carousel-dots" role="tablist" aria-label="Capturas de la aplicación">
        {SCREENSHOTS.map((shot, i) => (
          <button
            key={i}
            className={`carousel-dot ${i === current ? "carousel-dot--active" : ""}`}
            onClick={() => setCurrent(i)}
            role="tab"
            aria-selected={i === current}
            aria-label={shot.alt}
          />
        ))}
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  className = "",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <article className={`feature-card ${className}`} data-reveal>
      <div className="feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function formatBytes(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default App;
