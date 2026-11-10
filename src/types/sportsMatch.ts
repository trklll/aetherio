/** Render-ready match identity; never contains an addon's composed poster. */
export interface SportsMatchSide {
  name: string;
  crest?: string;
  fallbackCrest?: string;
  color: string;
  initials: string;
}

export interface SportsMatchArtwork {
  home?: SportsMatchSide;
  away?: SportsMatchSide;
  /** Verified local competition badge, when the event has a known competition. */
  competitionLogo?: string;
  /** Honest fallback for events without two named opponents. */
  label: string;
}
