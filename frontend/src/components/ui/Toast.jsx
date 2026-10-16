import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle, Warning, AlertOctagon, Info, Close } from "./icons";

const ToastContext = createContext(null);

const TYPE = {
  success: { Icon: CheckCircle, cls: "text-safe-700", bar: "bg-safe" },
  warning: { Icon: Warning, cls: "text-risk-700", bar: "bg-risk" },
  error: { Icon: AlertOctagon, cls: "text-danger-700", bar: "bg-danger" },
  info: { Icon: Info, cls: "text-brand", bar: "bg-brand" },
};

/** Wrap the app once. Toasts stack bottom-right (bottom, full width on phones). */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (message, { type = "info", title, duration = 5000 } = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, message, type, title }]);
      if (duration) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        aria-live="polite"
        className="fixed z-50 bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 flex flex-col gap-2 sm:w-96 pointer-events-none"
      >
        {toasts.map((t) => {
          const { Icon, cls, bar } = TYPE[t.type] || TYPE.info;
          return (
            <div
              key={t.id}
              role={t.type === "error" ? "alert" : "status"}
              className="pointer-events-auto relative overflow-hidden flex items-start gap-3 bg-surface border border-line rounded-xl shadow-pop pl-4 pr-2 py-3 animate-fade-up"
            >
              <span className={`absolute left-0 top-0 h-full w-1 ${bar}`} />
              <Icon size={18} className={`mt-0.5 ${cls}`} />
              <div className="flex-1 min-w-0 text-sm">
                {t.title && <p className="font-medium text-ink">{t.title}</p>}
                <p className="text-ink/80 break-words">{t.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="p-1 rounded text-muted hover:text-ink hover:bg-ink/5"
                aria-label="Dismiss notification"
              >
                <Close size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** const { toast } = useToast(); toast("Saved", { type: "success" }) */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
