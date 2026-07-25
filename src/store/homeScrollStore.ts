interface HomeScrollState {
  vertical: number;
  rows: Record<string, number>;
  hero: { kind: "single"; index: number } | { kind: "split"; anime: number; sm: number } | null;
}

let state: HomeScrollState | null = null;

export function saveHomeScroll(s: Partial<HomeScrollState>) {
  const prev = state ?? { vertical: 0, rows: {}, hero: null };
  state = {
    vertical: s.vertical ?? prev.vertical,
    rows: { ...prev.rows, ...(s.rows ?? {}) },
    hero: s.hero ?? prev.hero,
  };
}

export function getHomeScroll(): HomeScrollState | null {
  return state;
}

export function clearHomeScroll() {
  state = null;
}

export function rowKey(addonId: string, catalogId: string, type: string) {
  return `${addonId}/${catalogId}/${type}`;
}
