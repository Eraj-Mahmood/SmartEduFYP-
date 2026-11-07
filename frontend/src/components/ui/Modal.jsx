import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Close } from "./icons";

/**
 * Centered dialog (a bottom sheet on phones). Closes on Escape and backdrop click.
 * Focus moves into the dialog on open and back to the opener on close.
 */
export default function Modal({ open, onClose, title, subtitle, children, footer, width = "sm:max-w-lg" }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && typeof opener.focus === "function") opener.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-ink/40 animate-fade-up" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`relative w-full ${width} max-h-[92vh] bg-paper rounded-t-2xl sm:rounded-2xl shadow-pop flex flex-col outline-none animate-fade-up`}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 bg-surface border-b border-line rounded-t-2xl">
          <div className="min-w-0">
            <h2 className="font-display text-lg text-ink">{title}</h2>
            {subtitle && <div className="text-sm text-muted mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-lg text-muted hover:text-ink hover:bg-ink/5" aria-label="Close dialog">
            <Close size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="px-5 py-3 bg-surface border-t border-line sm:rounded-b-2xl flex flex-wrap justify-end gap-2">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
