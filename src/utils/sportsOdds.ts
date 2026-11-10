/** Explicit formats only: -145 is American moneyline, not fractional odds. */
export function decimalOdds(value: number | undefined | null, format: "decimal" | "american" = "decimal"): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (format === "decimal") return value > 1 ? value : undefined;
  if (Math.abs(value) < 100) return undefined;
  return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
}

export function formatDecimalOdds(value: number | undefined | null, format: "decimal" | "american" = "decimal"): string | undefined {
  return decimalOdds(value, format)?.toFixed(2);
}
