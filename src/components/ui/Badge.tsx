import tmdbLogo from "../../logoresources/themoviedb.png";

export default function TmdbRating({
  value,
  compact = false,
}: {
  value?: number | null;
  compact?: boolean;
}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;

  return (
    <span
      title="Puntuacion TMDB"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 5 : 6,
        color: "rgba(255,255,255,0.82)",
        lineHeight: 1,
        textShadow: "0 1px 8px rgba(0,0,0,0.42)",
        whiteSpace: "nowrap",
      }}
    >
      <img
        src={tmdbLogo}
        alt="TMDB"
        loading="eager"
        decoding="async"
        style={{
          width: compact ? 24 : 26,
          height: compact ? 16 : 26,
          objectFit: "contain",
          filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.32))",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: compact ? 14 : 14,
          fontWeight: 600,
          letterSpacing: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value.toFixed(1)}
      </span>
    </span>
  );
}
