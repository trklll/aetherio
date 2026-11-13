/** Set a range input through the native setter so React detects input events. */
export function getSteppedRangeValue(current: number, min: number, max: number, step: number, delta: number) {
  const next = Math.min(max, Math.max(min, current + delta));
  if (step <= 0) return next;
  return Math.min(max, Math.max(min, Math.round((next - min) / step) * step + min));
}

export function updateRangeInput(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function requestRangeInputValue(input: HTMLInputElement, value: number, animate = true) {
  input.dispatchEvent(new CustomEvent("aetherio-range-input-target", { detail: { value, animate } }));
}
