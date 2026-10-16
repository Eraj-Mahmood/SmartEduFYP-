// Base surface used by StatCard, ChartCard and the page sections.
export default function Card({ title, subtitle, actions, children, className = "", bodyClassName = "", as: Tag = "section" }) {
  return (
    <Tag className={`bg-surface rounded-card border border-line shadow-card min-w-0 ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[17px] leading-snug text-ink">{title}</h2>}
            {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`px-5 pb-5 ${title || actions ? "pt-3" : "pt-5"} ${bodyClassName}`}>{children}</div>
    </Tag>
  );
}
