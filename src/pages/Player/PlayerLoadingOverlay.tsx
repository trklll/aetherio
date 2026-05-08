interface PlayerLoadingOverlayProps {
  visible: boolean;
  artwork: string | null;
  title: string;
}

export default function PlayerLoadingOverlay({ visible, artwork, title }: PlayerLoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div className="flex flex-col items-center">
        {artwork ? (
          <img
            src={artwork}
            alt={title}
            className="aetherio-breathe max-h-32 w-auto max-w-[520px] object-contain drop-shadow-[0_18px_44px_rgba(0,0,0,0.8)]"
          />
        ) : null}
      </div>
    </div>
  );
}
