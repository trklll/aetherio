/** Editorial data, separate from ESPN. Never interpret missing coverage as zero titles.
 * Men's first-team totals transcribed from the official trophy room on 2026-11-06.
 */
export interface TeamHonours { source: string; checkedAt: string; partial?: boolean; competitions: { name: string; count: number; seasons: string }[] }
export const TEAM_HONOURS: Record<string, TeamHonours> = {
  "club:man-utd": {
    source: "https://www.manutd.com/en/history/trophy-room", checkedAt: "2026-11-06",
    competitions: [
      { name: "Liga inglesa", count: 20, seasons: "1908, 1911, 1952, 1956, 1957, 1965, 1967, 1993, 1994, 1996, 1997, 1999, 2000, 2001, 2003, 2007, 2008, 2009, 2011, 2013" },
      { name: "Copa de Europa / Champions League", count: 3, seasons: "1968, 1999, 2008" },
      { name: "FA Cup", count: 13, seasons: "1909, 1948, 1963, 1977, 1983, 1985, 1990, 1994, 1996, 1999, 2004, 2016, 2024" },
      { name: "Copa de la Liga", count: 6, seasons: "1991/92, 2005/06, 2008/09, 2009/10, 2016/17, 2022/23" },
      { name: "Community Shield", count: 21, seasons: "1908, 1911, 1952, 1956, 1957, 1965*, 1967*, 1977*, 1983, 1990*, 1993, 1994, 1996, 1997, 2003, 2007, 2008, 2010, 2011, 2013, 2016 · *Compartido" },
      { name: "Europa League", count: 1, seasons: "2016/17" },
      { name: "Supercopa de Europa", count: 1, seasons: "1991" },
      { name: "Mundial de Clubes", count: 1, seasons: "2008" },
      { name: "Copa Intercontinental", count: 1, seasons: "1999" },
      { name: "Recopa de Europa", count: 1, seasons: "1991" },
      { name: "Segunda División", count: 2, seasons: "1936, 1975" },
    ],
  },
};
