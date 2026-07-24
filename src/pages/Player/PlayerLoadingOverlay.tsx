import aetherioLogo from "../../assets/aetheriologo.png";

interface PlayerLoadingOverlayProps {
  visible: boolean;
  artwork: string | null;
  title: string;
  message?: string | null;
  hideMessage?: boolean;
  p2p?: boolean;
}

export default function PlayerLoadingOverlay({ visible, artwork, title, message, hideMessage }: PlayerLoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <img
          src={artwork || aetherioLogo}
          alt={title}
          className="aetherio-breathe max-h-32 w-auto max-w-[520px] object-contain drop-shadow-[0_18px_44px_rgba(0,0,0,0.8)]"
        />
        {message && !hideMessage ? (
          <p className="text-center text-sm text-white/65 max-w-[380px] leading-snug" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.7)" }}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
