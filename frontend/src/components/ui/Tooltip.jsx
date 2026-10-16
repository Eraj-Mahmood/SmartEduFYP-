import { useId, useState } from "react";

// Hover / focus / tap tooltip. The trigger must be focusable (e.g. a button).
// align: "center" (default), "start" (left edge on the trigger) or "end" - use start/end near
// screen edges so the bubble isn't clipped on phones.
const ALIGN = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0",
};

export default function Tooltip({ content, children, side = "top", align = "center" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pos = side === "bottom" ? "top-full mt-2" : "bottom-full mb-2";
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute ${ALIGN[align]} ${pos} z-30 w-60 max-w-[75vw] rounded-lg bg-ink px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-pop animate-fade-up`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
