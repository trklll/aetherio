import type { MdbListRatings } from "../config/mdblist.ts";
import type { SportsMatchArtwork } from "./sportsMatch.ts";

export type TrailerSource = "netflix" | "crunchyroll" | "hbo" | "disney" | "prime" | "apple" | "hulu" | "paramount" | "mubi" | "youtube" | "tmdb";
export type LibraryStatus = "to_watch" | "watched";

export interface MediaItem {
  id: string;
  type: string;
  name: string;
  /** Alternate localized/original titles used only for robust media searches. */
  searchAliases?: string[];
  poster?: string;
  /** Póster original (TMDB/Cinemeta) antes de aplicar SpatialPosters. Sirve como fallback si la instancia falla. */
  originalPoster?: string;
  background?: string;
  logo?: string;
  description?: string;
  imdbRating?: string;
  rating?: string;
  /** Personal rating imported from a connected service such as Trakt. */
  userRating?: number;
  /** The only two states a title can have in the user's library. */
  libraryStatus?: LibraryStatus;
  year?: number;
  genres?: string[];
  /** TMDB genre IDs preserve the canonical genre identity across translations. */
  genreIds?: number[];
  runtime?: string;
  certification?: string;
  heroGroup?: string;
  mdbListRatings?: MdbListRatings;
  trailerKey?: string;
  trailerSource?: TrailerSource;
  /** TV Sports composes opponent artwork instead of displaying addon posters. */
  sportsMatch?: SportsMatchArtwork;
}

export interface CatalogRowData {
  addonId: string;
  addonName: string;
  catalogId: string;
  type: string;
  name: string;
  subtitle?: string;
  presentation?: "cinematic";
  extraParams?: Record<string, string>;
  items: MediaItem[];
  order?: number;
}
