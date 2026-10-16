import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Close } from "./icons";

/** Right-side panel; full screen on phones. Closes on Escape and backdrop click. */
export default function Drawer({ open, onClose, title, subtitle, children, footer, width = "sm:max-w-md" }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/40 animate-fade-up" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`relative h-full w-full ${width} bg-paper shadow-pop flex flex-col outline-none animate-slide-in`}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 bg-surface border-b border-line">
          <div className="min-w-0">
            <h2 className="font-display text-lg text-ink truncate">{title}</h2>
            {subtitle && <div className="text-sm text-muted mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg text-muted hover:text-ink hover:bg-ink/5"
            aria-label="Close panel"
          >
            <Close size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="px-5 py-3 bg-surface border-t border-line">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
