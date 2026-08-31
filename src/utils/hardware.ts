let cachedLowEnd: boolean | null = null;

/**
 * Detects weak hardware (low core count / low memory) so image preloading and
 * decoding can be throttled. Re-running decodes are cheap: `hardwareConcurrency`
 * and `deviceMemory` are static, and the expensive work (no forced `decode()`)
 * is avoided up front.
 */
export function isLowEndDevice(): boolean {
  if (cachedLowEnd !== null) return cachedLowEnd;
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    cachedLowEnd = false;
    return false;
  }
  const cores = navigator.hardwareConcurrency;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  cachedLowEnd =
    (typeof cores === "number" && cores > 0 && cores <= 4) ||
    (typeof memory === "number" && memory > 0 && memory <= 4);
  return cachedLowEnd;
}

/** Number of simultaneous image decodes to allow while warming the Home. */
export function homeImagePreloadConcurrency(): number {
  return isLowEndDevice() ? 3 : 12;
}