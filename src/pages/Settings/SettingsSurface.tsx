import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { INPUT_BACK_EVENT } from "../../input/inputActions";
import { gsap, prefersReducedMotion } from "../../utils/motion";

interface HelpContext {
  describe: (id: string, description: string) => void;
}

const SettingsHelpContext = createContext<HelpContext>({ describe: () => undefined });
const SettingsHelpDescriptionContext = createContext("Personaliza Aetherio para verlo a tu manera.");

export function SettingsHelpProvider({ children }: { children: ReactNode }) {
  const [description, setDescription] = useState("Personaliza Aetherio para verlo a tu manera.");
  const describe = useCallback((_id: string, nextDescription: string) => {
    setDescription(current => current === nextDescription ? current : nextDescription);
  }, []);
  const help = useMemo(() => ({ describe }), [describe]);

  return <SettingsHelpContext.Provider value={help}>
    <SettingsHelpDescriptionContext.Provider value={description}>{children}</SettingsHelpDescriptionContext.Provider>
  </SettingsHelpContext.Provider>;
}

export function SettingsHelpDescription() {
  return <>{useContext(SettingsHelpDescriptionContext)}</>;
}

function focusOnMouseEnter(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === "mouse") event.currentTarget.focus({ preventScroll: true });
}

const DESCRIPTIONS: Record<string, string> = {
  "Velocidad al mantener": "Elige a qué velocidad se reproduce el vídeo al mantener la barra espaciadora.",
  "Idioma de audio preferido": "Aetherio elegirá este idioma de audio cuando esté disponible.",
  "Idioma de audio secundario": "Se usará este idioma si el audio preferido no está disponible.",
  "Idioma de subtítulos preferido": "Elige el idioma que prefieres para los subtítulos.",
  "Idioma de subtítulos secundario": "Se usará este idioma si no hay subtítulos en tu idioma preferido.",
  "Sincronización automática de subtítulos": "Decide cuándo intentar ajustar automáticamente el tiempo de los subtítulos.",
  "Modo de selección de stream": "Elige una fuente manualmente o reproduce la primera disponible.",
  "Hardware Decoding": "Usa la GPU para decodificar vídeo. Auto elige la opción compatible con tu equipo.",
  "Modo de umbral": "Decide si el siguiente episodio se prepara por porcentaje o por tiempo restante.",
  "Contenido principal": "Prioriza películas y series, anime o ambos sin ocultar el resto de catálogos.",
  "Preferencia de contenido": "Elige qué catálogos aparecen primero cuando se muestran ambos tipos de contenido.",
};

export function settingsDescription(title: string, description?: string) {
  return description || DESCRIPTIONS[title] || `Consulta y configura ${title.toLocaleLowerCase()}.`;
}

export function SettingsRow({ title, description, value, leading, onClick, onFocus, pressed }: {
  title: string;
  description?: string;
  value?: ReactNode;
  leading?: ReactNode;
  onClick: () => void;
  onFocus?: () => void;
  pressed?: boolean;
}) {
  const id = useId();
  const help = useContext(SettingsHelpContext);
  const describe = () => help.describe(id, settingsDescription(title, description));
  return <button type="button" className="settings-row" data-settings-row
    aria-label={title} aria-pressed={pressed} onFocus={() => { describe(); onFocus?.(); }} onPointerEnter={focusOnMouseEnter} onClick={onClick}>
    {leading ? <span className="settings-row__leading">{leading}</span> : null}
    <span className="settings-row__title">{title}</span>
    {value != null ? <span className="settings-row__value">{value}</span> : null}
    <ChevronRight className="settings-row__chevron" size={24} viewBox="6 3 12 18" preserveAspectRatio="none" strokeWidth={1.3} aria-hidden="true" />
  </button>;
}

/** Native top-layer dialog: keyboard trap and inert background, shared with the spatial engine. */
export function SettingsDialog({ title, description, children, onClose, choices = false, onConfirm, confirmLabel, hideHeader = false }: {
  title: string;
  description?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  onClose: () => void;
  choices?: boolean;
  onConfirm?: () => void;
  confirmLabel?: string;
  hideHeader?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closingRef = useRef(false);
  const closeDialogRef = useRef<(() => void) | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const reducedMotion = prefersReducedMotion();
    gsap.fromTo(dialog,
      { autoAlpha: 0, scale: reducedMotion ? 1 : 0.94, y: reducedMotion ? 0 : 12 },
      { autoAlpha: 1, scale: 1, y: 0, duration: reducedMotion ? 0.14 : 0.42, ease: "power3.out", overwrite: true },
    );
    const requestClose = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      gsap.to(dialog, {
        autoAlpha: 0,
        scale: reducedMotion ? 1 : 0.97,
        y: reducedMotion ? 0 : 8,
        duration: reducedMotion ? 0.12 : 0.22,
        ease: "power2.in",
        overwrite: true,
        onComplete: () => closeRef.current(),
      });
    };
    closeDialogRef.current = requestClose;
    (dialog.querySelector<HTMLElement>('[data-selected="true"]') ?? dialog.querySelector<HTMLElement>("input, button, select, textarea"))?.focus();
    const back = (event: Event) => {
      // A nested confirmation owns its own back action.
      const dialogs = document.querySelectorAll("dialog[open]");
      if (dialogs[dialogs.length - 1] !== dialog) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") back(event);
      if (event.key === "Tab") {
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']"))
          .filter(control => control.getBoundingClientRect().height > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    window.addEventListener(INPUT_BACK_EVENT, back, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener(INPUT_BACK_EVENT, back, true);
      window.removeEventListener("keydown", key, true);
      closeDialogRef.current = null;
      gsap.killTweensOf(dialog);
      dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog ref={ref} className={`settings-dialog${choices ? " settings-dialog--choices" : ""}`}
    data-spatial-modal aria-labelledby={titleId} aria-describedby={description && !hideHeader ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); closeDialogRef.current?.(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialogRef.current?.();
    }}>
    {hideHeader ? <span id={titleId} className="settings-visually-hidden">{title}</span> : <h2 id={titleId}>{title}</h2>}
    {!hideHeader && description ? <p id={descriptionId} className="settings-dialog__description">{description}</p> : null}
    <div className="settings-dialog__body">{typeof children === "function" ? children(() => closeDialogRef.current?.()) : children}</div>
    <button type="button" className={`settings-dialog__done${choices ? " settings-dialog__done--reject" : " settings-dialog__done--accept"}`} onPointerEnter={focusOnMouseEnter} onClick={() => { onConfirm?.(); closeDialogRef.current?.(); }}>{choices ? "Cancelar" : confirmLabel ?? (onConfirm ? "Guardar" : "Listo")}</button>
  </dialog>, document.body);
}

export function ChoiceSetting({ title, description, value, options, onChange }: {
  title: string;
  description?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <SettingsRow title={title} description={description} value={options.find(option => option.value === value)?.label ?? value} onClick={() => setOpen(true)} />
    {open ? <SettingsDialog title={title} choices onClose={() => setOpen(false)}>
      {close => <div className="settings-dialog__options">{options.map(option => <button type="button" key={option.value}
        className="settings-dialog__option" data-selected={option.value === value} aria-pressed={option.value === value} onPointerEnter={focusOnMouseEnter}
        onClick={() => { onChange(option.value); close(); }}>
        <span>{option.label}</span>{option.value === value ? <Check size={22} aria-hidden="true" /> : null}
      </button>)}</div>}
    </SettingsDialog> : null}
  </>;
}

export function PopupSetting({ title, description, value, leading, children, onSave, confirmLabel, onFocus, onOpen, onClose, hideHeader, hideDialogDescription }: {
  title: string;
  description?: string;
  value?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
  onSave?: () => void;
  confirmLabel?: string;
  onFocus?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  hideHeader?: boolean;
  hideDialogDescription?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <SettingsRow title={title} description={description} value={value} leading={leading} onFocus={onFocus} onClick={() => { setOpen(true); onOpen?.(); }} />
    {open ? <SettingsDialog title={title} description={hideDialogDescription ? undefined : description ? undefined : settingsDescription(title)} onClose={() => { setOpen(false); onClose?.(); }} onConfirm={onSave} confirmLabel={confirmLabel} hideHeader={hideHeader}>{children}</SettingsDialog> : null}
  </>;
}
