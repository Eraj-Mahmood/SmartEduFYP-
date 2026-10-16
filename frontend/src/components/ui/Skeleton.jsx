// Loading placeholders. Size with className (e.g. "h-4 w-32").
export default function Skeleton({ className = "h-4 w-full", rounded = "rounded-md" }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden bg-ink/[0.06] ${rounded} ${className} after:absolute after:inset-0 after:-translate-x-full after:bg-gradient-to-r after:from-transparent after:via-white/60 after:to-transparent after:animate-shimmer`}
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

/** A card-shaped skeleton for whole sections. */
export function SkeletonCard({ height = "h-56", className = "" }) {
  return (
    <div className={`bg-surface rounded-card border border-line p-5 ${className}`} role="status" aria-label="Loading">
      <Skeleton className="h-4 w-40 mb-4" />
      <Skeleton className={`${height} w-full`} rounded="rounded-lg" />
    </div>
  );
}
