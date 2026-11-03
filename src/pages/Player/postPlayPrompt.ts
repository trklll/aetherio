export const POST_PLAY_COUNTDOWN_MS = 12_000;

export function advancePostPlayCountdown(elapsed: number, delta: number, running: boolean) {
  return running ? Math.min(POST_PLAY_COUNTDOWN_MS, elapsed + Math.max(0, delta)) : elapsed;
}

/** A single slot: never show next/recommendation and skip outro together. */
export function resolvePostPlayAction({ nextReady, recommendationReady, dismissed, skipKind }: {
  nextReady: boolean;
  recommendationReady: boolean;
  dismissed: boolean;
  skipKind: string | null;
}): "next-episode" | "recommendation" | "skip" | null {
  if (nextReady || recommendationReady) {
    if (dismissed) return null;
    return nextReady ? "next-episode" : "recommendation";
  }
  return skipKind ? "skip" : null;
}
