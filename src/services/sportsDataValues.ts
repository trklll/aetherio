/** Small boundary readers: upstream HTML/errors/null must never become fabricated zeros. */
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
export function numeric(value: unknown): string | undefined {
  return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) ? String(value) : undefined;
}
export function identifier(value: unknown): string | undefined {
  const id = numeric(value);
  return id && /^[1-9]\d*$/.test(id) ? id : undefined;
}
