interface EntityScrollState {
  vertical: number;
  rows: Record<string, number>;
}

const states = new Map<string, EntityScrollState>();

export function saveEntityScroll(key: string, s: Partial<EntityScrollState>) {
  if (!key) return;
  const prev = states.get(key) ?? { vertical: 0, rows: {} };
  states.set(key, {
    vertical: s.vertical ?? prev.vertical,
    rows: { ...prev.rows, ...(s.rows ?? {}) },
  });
  while (states.size > 32) {
    const oldest = states.keys().next().value;
    if (typeof oldest !== "string") break;
    states.delete(oldest);
  }
}

export function getEntityScroll(key: string): EntityScrollState | null {
  if (!key) return null;
  return states.get(key) ?? null;
}

export function clearEntityScroll(key: string) {
  if (key) states.delete(key);
}
