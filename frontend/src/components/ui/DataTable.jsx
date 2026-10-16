import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown, Sort } from "./icons";
import EmptyState from "./EmptyState";
import Skeleton from "./Skeleton";

/**
 * DataTable columns rows rowKey
 * columns: [{ key, header, render?(row), sortValue?(row), sortable? (default true), align?, className?, width? }]
 * Sorting is client-side by default. Pass sort + onSortChange for server-side sorting.
 * The table scrolls horizontally inside its own box, never the page.
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  sort: controlledSort,
  onSortChange,
  loading = false,
  emptyMessage = "No rows to show",
  emptyDetail,
  caption,
  minWidth = 640,
  rowClassName,
}) {
  const [localSort, setLocalSort] = useState(initialSort || null);
  const sort = controlledSort !== undefined ? controlledSort : localSort;

  const sorted = useMemo(() => {
    if (!sort || onSortChange) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const get = col.sortValue || ((r) => r[col.key]);
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // blanks last
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort, columns, onSortChange]);

  function toggleSort(key) {
    const next = sort?.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
    if (onSortChange) onSortChange(next);
    else setLocalSort(next);
  }

  const align = (a) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="-mx-5 overflow-x-auto overscroll-x-contain">
      <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const sortable = c.sortable !== false;
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={`bg-surface border-b border-line px-3 first:pl-5 last:pr-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted whitespace-nowrap ${align(c.align)}`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${active ? "text-ink" : ""} ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      {c.header}
                      {active ? (sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <Sort size={13} className="opacity-40" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 5 }, (_, i) => (
              <tr key={`sk-${i}`}>
                {columns.map((c) => (
                  <td key={c.key} className="px-3 first:pl-5 last:pr-5 py-3 border-b border-line/70">
                    <Skeleton className="h-3.5 w-full max-w-[140px]" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            sorted.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row) : i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(row)) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={`${onRowClick ? "cursor-pointer hover:bg-brand-50/60 focus-visible:bg-brand-50 outline-none" : ""} ${rowClassName ? rowClassName(row) : ""}`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 first:pl-5 last:pr-5 py-3 border-b border-line/70 align-middle ${align(c.align)} ${c.className || ""}`}
                  >
                    {c.render ? c.render(row) : row[c.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && <EmptyState message={emptyMessage} detail={emptyDetail} compact />}
    </div>
  );
}

/** Pager for server-side pagination. */
export function Pagination({ page, totalPages, total, onPage, label = "rows" }) {
  if (!totalPages || totalPages <= 1) {
    return total != null ? <p className="text-xs text-muted pt-3">{total.toLocaleString()} {label}</p> : null;
  }
  const btn = "px-3 py-1.5 rounded-lg border border-line text-sm hover:bg-ink/5 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm">
      <span className="text-muted text-xs">
        Page {page} of {totalPages.toLocaleString()} · {total.toLocaleString()} {label}
      </span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className={btn} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
