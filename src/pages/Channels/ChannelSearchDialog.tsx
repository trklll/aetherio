import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import NameKeyboard, { type KeyboardMode } from "../../components/quickstart/NameKeyboard";
import { INPUT_BACK_EVENT, isEscapeKey } from "../../input/inputActions";

export default function ChannelSearchDialog({ value, onChange, onClose, count, triggerRef }: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  count: number;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [mode, setMode] = useState<KeyboardMode>("abc");

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => { if (isEscapeKey(event)) cancel(event); };
    window.addEventListener(INPUT_BACK_EVENT, cancel, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(INPUT_BACK_EVENT, cancel, true);
      window.removeEventListener("keydown", onKey, true);
      dialog?.close();
      trigger?.focus({ preventScroll: true });
    };
  }, [triggerRef]);

  return createPortal(
    <dialog ref={dialogRef} id="channels-search-dialog" className="channels-tv-search" data-spatial-modal data-channels-search
      aria-labelledby="channels-search-title" onCancel={event => { event.preventDefault(); onClose(); }}>
      <div className="channels-tv-search__header">
        <h2 id="channels-search-title">Buscar canal</h2>
        <button type="button" className="channels-tv-search__close" aria-label="Cerrar búsqueda" onClick={onClose}><X size={24} aria-hidden="true" /></button>
      </div>
      <output className="channels-tv-search__query" aria-label="Búsqueda de canal">{value || "Nombre del canal"}</output>
      <p className="channels-tv-search__count" role="status">{count ? `${count} ${count === 1 ? "canal encontrado" : "canales encontrados"}` : "Ningún canal coincide. Prueba con otro nombre."}</p>
      <NameKeyboard value={value} onChange={onChange} mode={mode} onModeChange={setMode} maxLength={60} />
      <button type="button" className="channels-tv-search__done" onClick={onClose}>Ver canales</button>
      <p className="channels-tv-search__hint">Cruceta para moverte · A para escribir · B para volver</p>
    </dialog>, document.body,
  );
}
