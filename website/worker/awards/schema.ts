import type { AwardCeremony, CeremonyMeta } from "./types";

export const CEREMONY_IDS: AwardCeremony[] = [
  "oscar",
  "cannes",
  "venice",
  "golden_globes",
  "bafta",
  "emmy",
  "goya",
  "japan_academy",
  "crunchyroll",
  "mar_del_plata",
];

// Orden estable para el destacado del hero (ver spec): Oscar, Cannes, Venice,
// Golden Globes, BAFTA, Emmy, Goya, Japan Academy, Crunchyroll y Mar del Plata.
export const CEREMONIES: Record<AwardCeremony, CeremonyMeta> = {
  oscar: {
    nameEs: "Premios Oscar",
    nameOriginal: "Academy Awards",
    featuredOrder: 1,
    mediaKinds: ["movie"],
  },
  cannes: {
    nameEs: "Festival de Cannes",
    nameOriginal: "Festival de Cannes",
    featuredOrder: 2,
    mediaKinds: ["movie"],
  },
  venice: {
    nameEs: "Festival de Venecia",
    nameOriginal: "Venice Film Festival",
    featuredOrder: 3,
    mediaKinds: ["movie"],
  },
  golden_globes: {
    nameEs: "Globos de Oro",
    nameOriginal: "Golden Globe Awards",
    featuredOrder: 4,
    mediaKinds: ["movie", "tv"],
  },
  bafta: {
    nameEs: "Premios BAFTA",
    nameOriginal: "British Academy Film Awards",
    featuredOrder: 5,
    mediaKinds: ["movie", "tv"],
  },
  emmy: {
    nameEs: "Premios Emmy",
    nameOriginal: "Emmy Awards",
    featuredOrder: 6,
    mediaKinds: ["tv"],
  },
  goya: {
    nameEs: "Premios Goya",
    nameOriginal: "Premios Goya",
    featuredOrder: 7,
    mediaKinds: ["movie"],
  },
  japan_academy: {
    nameEs: "Japan Academy Prize",
    nameOriginal: "日本アカデミー賞 (Japan Academy Prize)",
    featuredOrder: 8,
    mediaKinds: ["movie"],
  },
  crunchyroll: {
    nameEs: "Crunchyroll Anime Awards",
    nameOriginal: "Crunchyroll Anime Awards",
    featuredOrder: 9,
    mediaKinds: ["anime"],
  },
  mar_del_plata: {
    nameEs: "Festival de Mar del Plata",
    nameOriginal: "Festival Internacional de Cine de Mar del Plata",
    featuredOrder: 10,
    mediaKinds: ["movie"],
  },
};

export function isCeremony(value: string): value is AwardCeremony {
  return (CEREMONY_IDS as string[]).includes(value);
}

export function ceremonyOrder(ceremony: AwardCeremony): number {
  return CEREMONIES[ceremony].featuredOrder;
}
