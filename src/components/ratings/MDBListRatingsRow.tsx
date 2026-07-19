import {
  MDBLIST_PROVIDER_OPTIONS,
  type MdbListProvider,
  type MdbListRatings,
} from "../../config/mdblist";
import imdbLogo from "../../logoresources/IMDB_Logo_2016.svg.png";
import letterboxdLogo from "../../logoresources/Letterboxd-Logo-H-Pos-RGB.svg.png";
import metacriticLogo from "../../logoresources/Metacritic_logo.svg.png";
import rottenTomatoesLogo from "../../logoresources/Rotten_Tomatoes.svg.png";
import tmdbLogo from "../../logoresources/themoviedb.png";
import traktLogo from "../../logoresources/trakt_logo.png";

const PROVIDER_ORDER = MDBLIST_PROVIDER_OPTIONS.map(option => option.provider);
const PROVIDER_LOGOS: Record<MdbListProvider, string> = {
  trakt: traktLogo,
  imdb: imdbLogo,
  tmdb: tmdbLogo,
  letterboxd: letterboxdLogo,
  tomatoes: rottenTomatoesLogo,
  metacritic: metacriticLogo,
};

export default function MDBListRatingsRow({
  ratings,
  compact = false,
}: {
  ratings: MdbListRatings;
  compact?: boolean;
}) {
  const items = PROVIDER_ORDER
    .map(provider => {
      const rating = ratings[provider];
      return typeof rating === "number" ? { provider, rating } : null;
    })
    .filter((item): item is { provider: MdbListProvider; rating: number } => item !== null);

  if (!items.length) return null;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 8 : 10,
        flexWrap: "wrap",
        marginBottom: compact ? 0 : 14,
        verticalAlign: "middle",
      }}
    >
      {items.map(item => (
        <div
          key={item.provider}
          title={providerTitle(item.provider)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: compact ? 5 : 7,
            minHeight: compact ? 18 : 28,
            color: "rgba(255,255,255,0.88)",
            textShadow: "0 1px 8px rgba(0,0,0,0.46)",
            whiteSpace: "nowrap",
          }}
        >
          <ProviderLogo provider={item.provider} compact={compact} />
          <span
            style={{
              fontSize: compact ? 14 : 15,
              fontWeight: 600,
              lineHeight: compact ? "14px" : 1,
              letterSpacing: 0,
              fontFamily: "inherit",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatMdbListRating(item.rating)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProviderLogo({ provider, compact }: { provider: MdbListProvider; compact: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: logoWidth(provider, compact),
        height: compact ? 16 : 28,
        filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.32))",
        flexShrink: 0,
      }}
    >
      <img
        src={PROVIDER_LOGOS[provider]}
        alt=""
        loading="eager"
        decoding="async"
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </span>
  );
}

function logoWidth(provider: MdbListProvider, compact: boolean) {
  switch (provider) {
    case "imdb":
      return compact ? 32 : 44;
    case "tmdb":
      return compact ? 25 : 34;
    case "letterboxd":
      return compact ? 24 : 31;
    case "tomatoes":
      return compact ? 19 : 26;
    case "metacritic":
      return compact ? 19 : 26;
    default:
      return compact ? 20 : 27;
  }
}

function providerTitle(provider: MdbListProvider) {
  switch (provider) {
    case "trakt":
      return "Trakt";
    case "imdb":
      return "IMDb";
    case "tmdb":
      return "TMDB";
    case "letterboxd":
      return "Letterboxd";
    case "tomatoes":
      return "Rotten Tomatoes";
    case "metacritic":
      return "Metacritic";
  }
}

function formatMdbListRating(rating: number) {
  if (rating >= 10) return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
  return rating.toFixed(1);
}
