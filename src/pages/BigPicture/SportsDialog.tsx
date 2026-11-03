import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./SportsIptv.css";

/** Native dialog supplies the focus trap, background inertness and keyboard return. */
export default function SportsDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(
    <dialog ref={ref} className="sports-dialog" aria-label={title} data-spatial-modal onCancel={event => { event.preventDefault(); onClose(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}
      onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
      <header className="sports-dialog__header"><h2>{title}</h2><button type="button" className="sports-dialog__close" aria-label={`Cerrar ${title}`} onClick={onClose}><X size={20} /></button></header>
      {children}
    </dialog>, document.body,
  );
}
