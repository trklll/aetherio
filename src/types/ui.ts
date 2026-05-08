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
  heroGroup?: string;
}

export interface CatalogRowData {
  addonId: string;
  addonName: string;
  catalogId: string;
  type: string;
  name: string;
  items: MediaItem[];
}
