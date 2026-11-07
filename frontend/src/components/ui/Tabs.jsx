/**
 * Tabs tabs=[{key, label}] value onChange - a segmented tab bar (role=tablist).
 * The caller renders the active panel.
 */
export default function Tabs({ tabs, value, onChange, label = "Sections", className = "" }) {
  function onKey(e, i) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.key);
    e.currentTarget.parentElement.querySelector(`[data-tab="${next.key}"]`)?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className={`inline-flex rounded-lg bg-ink/[0.06] p-1 ${className}`}>
      {tabs.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-tab={t.key}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`px-3 py-1.5 rounded-md text-sm transition ${active ? "bg-surface text-ink font-medium shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
