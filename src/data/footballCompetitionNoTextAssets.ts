/**
 * Variantes sin texto integradas de Football Logos para la sidebar de Sports.
 * Los PNG y sus URLs de origen quedan registrados en
 * public/assets/football-logos/leagues/manifest.json.
 * Solo se incluyen competiciones del catálogo con una variante --no-text
 * publicada por Football Logos; las demás conservan su insignia habitual.
 */
const FOOTBALL_COMPETITION_NO_TEXT_LOGOS: Readonly<Record<string, string>> = {
  "comp:chi-primera": "/assets/football-logos/leagues/chile/512x512/liga-de-primera--no-text.c7aac6a9.png",
  "comp:isl-besta": "/assets/football-logos/leagues/iceland/512x512/besta-deild-karla--no-text.3d982987.png",
  "comp:isr-liga-1": "/assets/football-logos/leagues/israel/512x512/israeli-premier-league--no-text.a2bfcd22.png",
  "comp:mex-liga-mx-expansion": "/assets/football-logos/leagues/mexico/512x512/liga-de-expansion-mx--no-text.ea733d48.png",
  "comp:nor-eliteserien": "/assets/football-logos/leagues/norway/512x512/eliteserien--no-text.77eacc95.png",
  "comp:per-liga1": "/assets/football-logos/leagues/peru/512x512/peruvian-primera-division--no-text.a3ec25c3.png",
  "comp:qat-sleague": "/assets/football-logos/leagues/qatar/512x512/qatar-stars-league--no-text.b3f31887.png",
  "comp:sco-premiership": "/assets/football-logos/leagues/scotland/512x512/scottish-premiership--no-text.7150c6fe.png",
  "comp:esp-laliga": "/assets/football-logos/leagues/spain/512x512/la-liga--no-text.dfa1dfcb.png",
  "comp:esp-segunda": "/assets/football-logos/leagues/spain/512x512/la-liga-2--no-text.9733e0e8.png",
  "comp:uzb-super": "/assets/football-logos/leagues/uzbekistan/512x512/uzbekistan-super-league--no-text.a874d3f2.png",
  "comp:uefa-champions": "/assets/football-logos/leagues/tournaments/512x512/uefa-champions-league--no-text.aa9190d8.png",
  "comp:uefa-conference": "/assets/football-logos/leagues/tournaments/512x512/uefa-conference-league--no-text.11cffd52.png",
  "comp:uefa-europa": "/assets/football-logos/leagues/tournaments/512x512/uefa-europa-league--no-text.f5242ab6.png",
  "comp:uefa-nations-league": "/assets/football-logos/leagues/tournaments/512x512/uefa-nations-league--no-text.3f99cc03.png",
};

export function footballCompetitionNoTextLogo(competitionId: string): string | null {
  return FOOTBALL_COMPETITION_NO_TEXT_LOGOS[competitionId] ?? null;
}
