const VARIANT = {
  primary: "bg-brand text-white hover:bg-brand-dark disabled:bg-brand/60",
  secondary: "bg-surface text-ink border border-line hover:bg-ink/5",
  ghost: "text-brand hover:bg-brand-50",
  danger: "bg-danger text-white hover:bg-danger-700",
};
const SIZE = { sm: "text-sm px-3 py-1.5", md: "text-sm px-4 py-2", lg: "text-base px-5 py-2.5" };

/** Button variant="primary|secondary|ghost|danger" loading icon */
export default function Button({ variant = "primary", size = "md", loading = false, icon, children, className = "", disabled, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? (
        <span className="h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
