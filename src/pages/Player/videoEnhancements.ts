export type VideoEnhancementFamily = "anime4k" | "fsr" | "hardware" | "mpv";

export interface VideoEnhancementOption {
  value: string;
  label: string;
  description: string;
}

export const VIDEO_ENHANCEMENT_DISABLED = "off";
export const VIDEO_ENHANCEMENT_STORAGE_KEY = "aetherio-player-video-enhancement";
const LEGACY_ANIME4K_STORAGE_KEY = "aetherio-player-anime4k-profile";

const MODE_LABELS: Record<string, { label: string; description: string }> = {
  "mode-a": {
    label: "Modo A",
    description: "Restauración y escalado para anime comprimido.",
  },
  "mode-b": {
    label: "Modo B",
    description: "Restauración suave para evitar bordes excesivos.",
  },
  "mode-c": {
    label: "Modo C",
    description: "Reducción de ruido y escalado.",
  },
  "mode-aa": {
    label: "Modo A+A",
    description: "Doble restauración para fuentes muy degradadas.",
  },
  "mode-bb": {
    label: "Modo B+B",
    description: "Doble restauración suave.",
  },
  "mode-ca": {
    label: "Modo C+A",
    description: "Reducción de ruido seguida de restauración.",
  },
  "cnn-2x-medium": {
    label: "CNN 2x Medio",
    description: "Escalado CNN equilibrado de una sola pasada.",
  },
  "cnn-2x-very-large": {
    label: "CNN 2x Muy grande",
    description: "Escalado CNN de alta precisión y alto consumo.",
  },
  "denoise-cnn-2x-very-large": {
    label: "CNN 2x + Denoise",
    description: "Escalado y reducción de ruido de alta precisión.",
  },
  "cnn-2x-ultra-large": {
    label: "CNN 2x Ultra",
    description: "Máxima calidad; requiere una GPU potente.",
  },
};

const COMPOSED_MODES = ["mode-a", "mode-b", "mode-c", "mode-aa", "mode-bb", "mode-ca"];
const STANDALONE_CNN_MODES = [
  "cnn-2x-medium",
  "cnn-2x-very-large",
  "denoise-cnn-2x-very-large",
  "cnn-2x-ultra-large",
];

const ANIME4K_PROFILE_OPTIONS: VideoEnhancementOption[] = [
  {
    value: VIDEO_ENHANCEMENT_DISABLED,
    label: "Sin mejoras",
    description: "Renderizado original de MPV.",
  },
  ...(["fast", "hq"] as const).flatMap(quality =>
    COMPOSED_MODES.map(mode => ({
      value: `${quality}:${mode}`,
      label: `Anime4K · ${MODE_LABELS[mode].label} · ${quality === "fast" ? "Rápido" : "Alta calidad"}`,
      description: MODE_LABELS[mode].description,
    })),
  ),
  ...STANDALONE_CNN_MODES.map(mode => ({
    value: `fast:${mode}`,
    label: `Anime4K · ${MODE_LABELS[mode].label}`,
    description: MODE_LABELS[mode].description,
  })),
];

export const VIDEO_ENHANCEMENT_OPTIONS: VideoEnhancementOption[] = [
  ...ANIME4K_PROFILE_OPTIONS,
  {
    value: "fsr:quality",
    label: "AMD FSR 1.0 · Calidad",
    description: "Escalado FidelityFX de propósito general, compatible con el preset FSR de Stremio Community V5.",
  },
  {
    value: "vsr:nvidia-2x",
    label: "NVIDIA RTX VSR · 2x",
    description: "Super Resolution por D3D11. Requiere una GPU y controlador NVIDIA compatibles.",
  },
  {
    value: "scaler:ewa-lanczossharp",
    label: "MPV · Lanczos Sharp",
    description: "Escalado nativo de alta nitidez con protección antiringing.",
  },
  {
    value: "scaler:spline36",
    label: "MPV · Spline36",
    description: "Escalado nativo equilibrado para vídeo y cine.",
  },
  {
    value: "deband:balanced",
    label: "MPV · Reducir bandas",
    description: "Suaviza gradientes con banding sin aplicar reescalado.",
  },
];

const LEGACY_STANDALONE_HQ_PROFILES: Record<string, string> = Object.fromEntries(
  STANDALONE_CNN_MODES.map(mode => [`hq:${mode}`, `fast:${mode}`]),
);

export function normalizeVideoEnhancementProfile(profile: string) {
  const candidate = LEGACY_STANDALONE_HQ_PROFILES[profile] ?? profile;
  return VIDEO_ENHANCEMENT_OPTIONS.some(option => option.value === candidate)
    ? candidate
    : VIDEO_ENHANCEMENT_DISABLED;
}

export function readVideoEnhancementProfile() {
  try {
    const saved = localStorage.getItem(VIDEO_ENHANCEMENT_STORAGE_KEY)
      ?? localStorage.getItem(LEGACY_ANIME4K_STORAGE_KEY)
      ?? VIDEO_ENHANCEMENT_DISABLED;
    return normalizeVideoEnhancementProfile(saved);
  } catch {
    return VIDEO_ENHANCEMENT_DISABLED;
  }
}

export function saveVideoEnhancementProfile(profile: string) {
  const normalized = normalizeVideoEnhancementProfile(profile);
  try {
    localStorage.setItem(VIDEO_ENHANCEMENT_STORAGE_KEY, normalized);
  } catch {
    // The active session still applies the selected profile.
  }
  return normalized;
}
