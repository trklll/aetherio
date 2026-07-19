import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { tmdbFetch } from "../../config/apiKeys";
import "./person.css";
import { scrollByGsap } from "../../utils/motion";

const IMG = "https://image.tmdb.org/t/p";

type CreditType = "movie" | "series";

interface PersonCredit {
  id: number;
  title: string;
  type: CreditType;
  posterUrl: string;
  backdropUrl: string;
  logoUrl: string;
  year: string;
  role: string;
  department: string;
  voteAverage: number;
  voteCount: number;
  episodeCount: number;
  popularity: number;
}

interface PersonDetail {
  id: number;
  name: string;
  biography: string;
  profileUrl: string;
  images: string[];
  knownForDepartment: string;
  birthday: string;
  deathday: string;
  placeOfBirth: string;
  alsoKnownAs: string[];
  knownFor: PersonCredit[];
  credits: PersonCredit[];
}

export default function PersonPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [biographyOpen, setBiographyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setPerson(null);
      try {
        const personId = await resolvePersonId(id);
        if (!personId) return;
        const data = await tmdbFetch<any>(`/person/${personId}`, {
          params: {
            language: "es-ES",
            append_to_response: "images,external_ids,movie_credits,tv_credits",
          },
        });
        if (!data || cancelled) return;

        const profileUrl = imageUrl(data.profile_path, "w500");
        const images = unique([
          profileUrl,
          ...(data.images?.profiles ?? []).map((image: any) => imageUrl(image.file_path, "w500")),
        ]).filter(Boolean).slice(0, 10);
        const credits = [
          ...(data.movie_credits?.cast ?? []).map((credit: any) => mapCredit(credit, "movie")),
          ...(data.tv_credits?.cast ?? []).map((credit: any) => mapCredit(credit, "series")),
        ].filter((credit: PersonCredit | null): credit is PersonCredit => Boolean(credit));
        const deduped = dedupeCredits(credits).sort((a, b) => {
          const yearDifference = (Number(b.year) || 0) - (Number(a.year) || 0);
          return yearDifference || b.popularity - a.popularity;
        });
        const knownForBase = deduped
          .filter(credit => credit.backdropUrl || credit.posterUrl)
          .sort((a, b) => knownForScore(b) - knownForScore(a))
          .slice(0, 12);
        const basePerson: PersonDetail = {
          id: personId,
          name: data.name ?? "",
          biography: data.biography ?? "",
          profileUrl,
          images,
          knownForDepartment: data.known_for_department || "Acting",
          birthday: data.birthday ?? "",
          deathday: data.deathday ?? "",
          placeOfBirth: data.place_of_birth ?? "",
          alsoKnownAs: Array.isArray(data.also_known_as) ? data.also_known_as : [],
          knownFor: knownForBase,
          credits: deduped,
        };
        setPerson(basePerson);
        setLoading(false);

        void Promise.all(knownForBase.map(async credit => ({
          ...credit,
          logoUrl: await fetchCreditLogo(credit),
        }))).then(knownFor => {
          if (!cancelled) setPerson(current => current ? { ...current, knownFor } : current);
        });
      } catch (error) {
        console.warn("Person load error:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!biographyOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBiographyOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [biographyOpen]);

  if (loading) return <PersonLoading />;
  if (!person) return <div className="person-empty">No se encontró la persona.</div>;

  return (
    <div className="person-page">
      <PersonBackground person={person} />
      <main className="person-content">
        <header className="person-header"><h1>{person.name}</h1></header>

        <section className="person-overview">
          <div className="person-gallery-column">
            <HorizontalRail className="person-gallery" label="Retratos" resetKey={person.id}>
              {(person.images.length ? person.images : [person.profileUrl]).filter(Boolean).map((image, index) => (
                <div className="person-portrait" tabIndex={0} key={`${image}-${index}`}>
                  <img src={image} alt={person.name} decoding="async" />
                </div>
              ))}
            </HorizontalRail>
            {person.biography ? (
              <button className="person-biography-preview" type="button" onClick={() => setBiographyOpen(true)}>
                <span>{person.biography}</span>
              </button>
            ) : <p className="person-biography-missing">Biografía no disponible.</p>}
          </div>

          <PersonalInfo person={person} />
        </section>

        {person.knownFor.length ? (
          <section className="person-section person-known-section">
            <h2>Conocido por</h2>
            <HorizontalRail className="person-known-row" label="Conocido por" resetKey={person.id}>
              {person.knownFor.map(credit => (
                <KnownForCard
                  key={`${credit.type}:${credit.id}`}
                  credit={credit}
                  onClick={() => openCredit(navigate, credit)}
                />
              ))}
            </HorizontalRail>
          </section>
        ) : null}

        <CreditsSection credits={person.credits} onOpen={credit => openCredit(navigate, credit)} />
      </main>

      {biographyOpen ? (
        <div className="person-biography-dialog" role="presentation" onClick={() => setBiographyOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="person-biography-title" onClick={event => event.stopPropagation()}>
            <h2 id="person-biography-title">{person.name}</h2>
            <p>{person.biography}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PersonBackground({ person }: { person: PersonDetail }) {
  const ambient = person.profileUrl || person.images[0];
  return (
    <div className="person-background" aria-hidden="true">
      {ambient ? <img src={ambient} alt="" /> : null}
      <div className="person-background-tint" />
      <div className="person-background-radial" />
      <div className="person-background-vertical" />
      <div className="person-background-bottom" />
    </div>
  );
}

function PersonalInfo({ person }: { person: PersonDetail }) {
  const rows = [
    ["Área de trabajo", translateDepartment(person.knownForDepartment)],
    ["Nacimiento", formatLifeDate(person.birthday, person.deathday)],
    ["Lugar de nacimiento", person.placeOfBirth],
    ["También conocido como", person.alsoKnownAs.slice(0, 2).join(", ")],
  ].filter(([, value]) => value);
  return (
    <aside className="person-info-card">
      <h2>Información personal</h2>
      {rows.map(([label, value]) => (
        <div className="person-info-line" key={label}>
          <h3>{label}</h3>
          <p>{value}</p>
        </div>
      ))}
    </aside>
  );
}

function KnownForCard({ credit, onClick }: { credit: PersonCredit; onClick: () => void }) {
  const artwork = credit.backdropUrl || credit.posterUrl;
  return (
    <button className="person-known-card" type="button" onClick={onClick}>
      {artwork ? <img className="person-known-artwork" src={artwork} alt={credit.title} loading="lazy" decoding="async" /> : null}
      <span className="person-known-scrim" />
      {credit.logoUrl ? (
        <img className="person-known-logo" src={credit.logoUrl} alt={credit.title} loading="lazy" decoding="async" />
      ) : <span className="person-known-title">{credit.title}</span>}
    </button>
  );
}

function HorizontalRail({ className, label, resetKey, children }: { className: string; label: string; resetKey: string | number; children: ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    const max = rail.scrollWidth - rail.clientWidth;
    setCanScrollLeft(rail.scrollLeft > 4);
    setCanScrollRight(max > 4 && rail.scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(update);
    observer.observe(rail);
    rail.addEventListener("scroll", update, { passive: true });
    const frame = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      rail.removeEventListener("scroll", update);
    };
  }, [children, update]);

  useEffect(() => {
    railRef.current?.scrollTo({ left: 0, behavior: "auto" });
    update();
  }, [resetKey, update]);

  function move(direction: "left" | "right") {
    const rail = railRef.current;
    if (!rail) return;
    scrollByGsap(rail, (direction === "right" ? 1 : -1) * rail.clientWidth * 0.82);
  }

  return (
    <div className="person-rail-shell" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button className="person-rail-arrow person-rail-arrow-left" type="button" aria-label={`Anterior: ${label}`} onClick={() => move("left")} data-visible={hovered && canScrollLeft}>
        <ChevronLeft size={18} />
      </button>
      <div ref={railRef} className={className}>{children}</div>
      <button className="person-rail-arrow person-rail-arrow-right" type="button" aria-label={`Siguiente: ${label}`} onClick={() => move("right")} data-visible={hovered && canScrollRight}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function CreditsSection({ credits, onOpen }: { credits: PersonCredit[]; onOpen: (credit: PersonCredit) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, PersonCredit[]>();
    credits.forEach(credit => {
      const year = credit.year || "Sin fecha";
      map.set(year, [...(map.get(year) ?? []), credit]);
    });
    return [...map.entries()];
  }, [credits]);

  return (
    <section className="person-section person-credits-section">
      <h2>Créditos</h2>
      {!groups.length ? <p className="person-no-credits">No hay créditos disponibles.</p> : null}
      {groups.map(([year, items]) => (
        <div className="person-credit-year" key={year}>
          <h3>{year}</h3>
          <div className="person-credit-list">
            {items.map((credit, index) => (
              <CreditCard key={`${credit.type}:${credit.id}:${credit.role}:${index}`} credit={credit} onClick={() => onOpen(credit)} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function CreditCard({ credit, onClick }: { credit: PersonCredit; onClick: () => void }) {
  const episodeSuffix = credit.type === "series" && credit.episodeCount > 0 ? ` - ${credit.episodeCount} eps` : "";
  return (
    <button className="person-credit-card" type="button" onClick={onClick}>
      <span className="person-credit-poster">
        {credit.posterUrl ? <img src={credit.posterUrl} alt={credit.title} loading="lazy" decoding="async" /> : credit.title.slice(0, 1)}
      </span>
      <span className="person-credit-copy">
        <strong>{credit.title}</strong>
        <span>{translateDepartment(credit.department)} - {translateType(credit.type)}{episodeSuffix}</span>
        <span>Puntuación {formatScore(credit.voteAverage)} &nbsp;&nbsp; {credit.voteCount} votos</span>
        {credit.role ? <b>{credit.role}</b> : null}
      </span>
    </button>
  );
}

function PersonLoading() {
  return <div className="person-loading">Cargando actor</div>;
}

async function resolvePersonId(rawId: string) {
  const decoded = decodeURIComponent(rawId).replace(/^cast:/i, "").replace(/^link:/i, "").trim();
  const numeric = Number(decoded.replace(/^tmdb:/i, ""));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (!decoded) return null;
  const data = await tmdbFetch<any>("/search/person", { params: { query: decoded, language: "es-ES", page: "1" } });
  const result = Number(data?.results?.[0]?.id);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function mapCredit(raw: any, type: CreditType): PersonCredit | null {
  const id = Number(raw?.id);
  const title = String(raw?.title ?? raw?.name ?? "").trim();
  if (!Number.isFinite(id) || !title) return null;
  const releaseDate = String(raw?.release_date ?? raw?.first_air_date ?? "");
  return {
    id,
    title,
    type,
    posterUrl: imageUrl(raw?.poster_path, "w342"),
    backdropUrl: imageUrl(raw?.backdrop_path, "w780"),
    logoUrl: "",
    year: releaseDate.slice(0, 4),
    role: String(raw?.character ?? ""),
    department: "Actuación",
    voteAverage: Number(raw?.vote_average) || 0,
    voteCount: Number(raw?.vote_count) || 0,
    episodeCount: Number(raw?.episode_count) || 0,
    popularity: Number(raw?.popularity) || 0,
  };
}

async function fetchCreditLogo(credit: PersonCredit) {
  try {
    const endpoint = credit.type === "movie" ? "movie" : "tv";
    const data = await tmdbFetch<any>(`/${endpoint}/${credit.id}/images`, {
      params: { include_image_language: "es,en,null" },
    });
    const logos = Array.isArray(data?.logos) ? data.logos : [];
    const preferred = logos.find((logo: any) => logo?.iso_639_1 === "es")
      ?? logos.find((logo: any) => logo?.iso_639_1 === "en")
      ?? logos[0];
    return imageUrl(preferred?.file_path, "w500");
  } catch {
    return "";
  }
}

function dedupeCredits(credits: PersonCredit[]) {
  const seen = new Set<string>();
  return credits.filter(credit => {
    const key = `${credit.type}:${credit.id}:${credit.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function knownForScore(credit: PersonCredit) {
  return credit.popularity + credit.voteAverage + Math.log10(Math.max(1, credit.voteCount + 1));
}

function imageUrl(path: unknown, size: string) {
  return typeof path === "string" && path ? `${IMG}/${size}${path}` : "";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function openCredit(navigate: ReturnType<typeof useNavigate>, credit: PersonCredit) {
  navigate(`/detail/${credit.type}/tmdb:${credit.id}`);
}

function translateDepartment(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "acting" || normalized === "actuacion" || normalized === "actuación") return "Actuación";
  if (normalized === "directing") return "Dirección";
  if (normalized === "writing") return "Guion";
  if (normalized === "production") return "Producción";
  return value || "Actuación";
}

function translateType(value: CreditType) {
  return value === "movie" ? "Película" : "Serie";
}

function formatScore(value: number) {
  return value > 0 ? value.toFixed(1) : "0.0";
}

function formatLifeDate(birthday: string, deathday: string) {
  const born = formatDate(birthday);
  if (!born) return "";
  const died = formatDate(deathday);
  return died ? `${born} - ${died}` : born;
}

function formatDate(value: string) {
  if (!value || value.toLowerCase() === "null") return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric" }).format(date);
}
