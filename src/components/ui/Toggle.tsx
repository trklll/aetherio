// Badges de formato estilo Apple TV+
// 4K · DV · HDR · Atmos · CC · SDH
// Se muestran siempre como indicadores de capacidad máxima de la plataforma

interface BadgeProps { label: string; style?: "box" | "text" }

function Badge({ label, style = "box" }: BadgeProps) {
  if (style === "text") {
    return (
      <span className="text-[10px] font-semibold text-atv-secondary tracking-wide">{label}</span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center px-1 py-0.5 rounded text-[9px] font-bold tracking-wider border border-atv-secondary/50 text-atv-secondary leading-none">
      {label}
    </span>
  );
}

// Dolby Vision — styled badge
function DVBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-atv-secondary/40 leading-none">
      <span className="text-[8px] font-black text-atv-secondary tracking-tighter">DOLBY</span>
      <span className="text-[8px] font-black text-atv-secondary tracking-tighter">VISION</span>
    </span>
  );
}

// Atmos
function AtmosBadge() {
  return (
    <span className="inline-flex items-center px-1 py-0.5 rounded border border-atv-secondary/40 leading-none">
      <span className="text-[8px] font-black text-atv-secondary tracking-tighter">ATMOS</span>
    </span>
  );
}

interface FormatBadgesProps {
  quality?: "4K" | "1080p" | "720p";
  showDV?: boolean;
  showAtmos?: boolean;
  showCC?: boolean;
  showSDH?: boolean;
}

export default function FormatBadges({
  quality = "4K",
  showDV = true,
  showAtmos = true,
  showCC = true,
  showSDH = true,
}: FormatBadgesProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge label={quality} />
      {showDV && <DVBadge />}
      {showAtmos && <AtmosBadge />}
      {showCC && <Badge label="CC" />}
      {showSDH && <Badge label="SDH" />}
    </div>
  );
}