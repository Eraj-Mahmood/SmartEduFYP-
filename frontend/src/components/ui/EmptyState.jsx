import { Inbox } from "./icons";

/** EmptyState icon message [detail] [action: node | {label, onClick}] */
export default function EmptyState({ icon, message, detail, action, compact = false, className = "" }) {
  const IconEl = icon || <Inbox size={22} />;
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-6" : "py-10"} px-4 ${className}`}>
      <div className="h-11 w-11 rounded-full bg-brand-50 text-brand flex items-center justify-center mb-3">{IconEl}</div>
      <p className="text-sm font-medium text-ink max-w-sm">{message}</p>
      {detail && <p className="text-sm text-muted mt-1 max-w-sm">{detail}</p>}
      {action && (
        <div className="mt-4">
          {action.label ? (
            <button
              type="button"
              onClick={action.onClick}
              className="text-sm font-medium text-brand hover:text-brand-dark underline-offset-2 hover:underline"
            >
              {action.label}
            </button>
          ) : (
            action
          )}
        </div>
      )}
    </div>
  );
}
