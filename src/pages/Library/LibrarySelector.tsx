import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { INPUT_BACK_EVENT, isBackspaceKey, isEscapeKey } from "../../input/inputActions";

export default function LibrarySelector({
  label, value, options, onChange, bigPicture = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  bigPicture?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const initial = dialog?.querySelector<HTMLButtonElement>("[data-library-option]");
    initial?.focus({ preventScroll: true });
    initial?.scrollIntoView({ block: "nearest" });

    const cancel = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (!isEscapeKey(event) && !isBackspaceKey(event)) return;
      cancel(event);
    };
    // Capture detiene las teclas antes de que alcancen el contenido exterior.
    // El back de Big Picture comprueba también la presencia del selector.
    window.addEventListener(INPUT_BACK_EVENT, cancel, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(INPUT_BACK_EVENT, cancel, true);
      window.removeEventListener("keydown", onKey, true);
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!bigPicture) {
    return (
      <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
        <span className="text-sm font-black text-white">{label}</span>
        <div className="relative">
          <select
            value={selected?.value ?? ""}
            onChange={event => onChange(event.target.value)}
            className="library-filter-select h-10 w-full appearance-none rounded-xl border border-white/10 bg-black/30 pl-3 pr-12 text-sm font-bold text-white outline-none"
          >
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"
            size={16}
            aria-hidden="true"
          />
        </div>
      </label>
    );
  }

  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-black text-white">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="library-tv-selector h-10 rounded-xl border border-white/10 bg-black/30 pl-3 pr-5 text-sm font-bold text-white"
        aria-label={`${label}: ${selected?.label ?? "Sin opciones"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-dialog` : undefined}
        disabled={!options.length}
        onClick={() => setOpen(true)}
      >
        <span>{selected?.label ?? "Sin opciones"}</span>
      </button>
      {open && createPortal(
        <div className="library-tv-picker-backdrop" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div
            ref={dialogRef}
            id={`${id}-dialog`}
            className="library-tv-picker"
            data-spatial-modal
            data-library-tv-picker
            data-spatial-navigation="local"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            onKeyDown={event => {
              if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
              buttons[next]?.focus({ preventScroll: true });
              buttons[next]?.scrollIntoView({ block: "nearest" });
            }}
          >
            <div className="library-tv-picker__header">
              <h2 id={`${id}-title`}>{label}</h2>
            </div>
            <div className="library-tv-picker__options">
              {options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  data-library-option
                  data-library-option-index={index}
                  tabIndex={index === 0 ? 0 : -1}
                  data-selected={option.value === selected?.value}
                  aria-pressed={option.value === selected?.value}
                  onClick={() => { onChange(option.value); setOpen(false); }}
                >
                  <span>{option.label}</span>
                  {option.value === selected?.value ? <Check size={22} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>, document.body,
      )}
    </div>
  );
}
