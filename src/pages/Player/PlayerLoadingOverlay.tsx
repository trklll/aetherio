import { useEffect, useState } from "react";
import aetherioLogo from "../../assets/aetheriologo.png";

const LOADING_MESSAGES = [
  "Conectando con la red P2P...",
  "Buscando peers disponibles...",
  "Descargando metadatos del torrent...",
  "Solicitando piezas del archivo...",
  "Preparando stream para reproduccion...",
];

interface PlayerLoadingOverlayProps {
  visible: boolean;
  artwork: string | null;
  title: string;
  message?: string | null;
  hideMessage?: boolean;
  p2p?: boolean;
}

export default function PlayerLoadingOverlay({ visible, artwork, title, message, hideMessage, p2p }: PlayerLoadingOverlayProps) {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setMsgIndex(0);
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % LOADING_MESSAGES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const showMessage = p2p && !hideMessage;
  const displayMessage = message ?? LOADING_MESSAGES[msgIndex];

  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <div className="flex flex-col items-center gap-4">
        <img
          src={artwork || aetherioLogo}
          alt={title}
          className="aetherio-breathe max-h-32 w-auto max-w-[520px] object-contain drop-shadow-[0_18px_44px_rgba(0,0,0,0.8)]"
        />
        {showMessage && <p className="animate-pulse text-center text-sm text-white/48">{displayMessage}</p>}
      </div>
    </div>
  );
}