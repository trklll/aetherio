import type { MdbListRatings } from "../config/mdblist.ts";

export type TrailerSource = "netflix" | "crunchyroll" | "hbo" | "disney" | "youtube" | "tmdb";

export interface MediaItem {
  id: string;
  type: string;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  imdbRating?: string;
  rating?: string;
  year?: number;
  genres?: string[];
  runtime?: string;
  certification?: string;
  heroGroup?: string;
  mdbListRatings?: MdbListRatings;
  trailerKey?: string;
  trailerSource?: TrailerSource;
}

export interface CatalogRowData {
  addonId: string;
  addonName: string;
  catalogId: string;
  type: string;
  name: string;
  subtitle?: string;
  extraParams?: Record<string, string>;
  items: MediaItem[];
}
