import { useEffect, useState } from "react";
import { PortalShell } from "../../components/Shell";
import { Card, DataTable, Pagination, Drawer, EmptyState, Button, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";
import { timeAgo } from "../../lib/format";

// Who changed what: every audit-logged action (results, attendance, counselor assignments,
// tutorials, interventions, account changes...), newest first, with the full details as JSON.

const when = (v) => new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function AuditLog() {
  const [filters, setFilters] = useState({ actor: "", action: "", entity: "", from: "", to: "" });
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, actor })), 350);
    return () => clearTimeout(t);
  }, [actor]);
  useEffect(() => setPage(1), [filters]);

  const params = { ...filters, page, limit: 25 };
  Object.keys(params).forEach((k) => params[k] === "" && delete params[k]);
  const log = useApi("/admin/audit-log", { params });
  const data = log.data || { rows: [], total: 0, page: 1, totalPages: 0, actions: [], entities: [] };
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const any = Object.values(filters).some(Boolean);

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-1">Audit log</h1>
      <p className="text-muted text-sm mb-5">Every recorded change, newest first. Select a row to see its details.</p>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
          <label className="relative lg:col-span-1">
            <span className="sr-only">Actor</span>
            <Icons.Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" className="field pl-9" placeholder="Actor email or id" value={actor} onChange={(e) => setActor(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Action</span>
            <select className="field" value={filters.action} onChange={set("action")}>
              <option value="">All actions</option>
              {data.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Entity</span>
            <select className="field" value={filters.entity} onChange={set("entity")}>
              <option value="">All entities</option>
              {data.entities.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-xs text-muted w-9 shrink-0">From</span>
            <input type="date" className="field" value={filters.from} max={filters.to || undefined} onChange={set("from")} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-xs text-muted w-9 shrink-0">To</span>
            <input type="date" className="field" value={filters.to} min={filters.from || undefined} onChange={set("to")} />
          </label>
        </div>
        {any && (
          <button
            type="button"
            className="mb-3 text-xs font-medium text-brand hover:underline"
            onClick={() => {
              setActor("");
              setFilters({ actor: "", action: "", entity: "", from: "", to: "" });
            }}
          >
            Clear filters
          </button>
        )}

        {log.error ? (
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load the audit log" detail={log.error} action={<Button variant="secondary" onClick={() => log.reload()}>Try again</Button>} />
        ) : (
          <>
            <DataTable
              loading={log.loading && !log.data}
              rows={data.rows}
              rowKey={(r) => r.log_id}
              onRowClick={setOpen}
              minWidth={760}
              emptyMessage="No entries match these filters"
              columns={[
                {
                  key: "created_at",
                  header: "When",
                  sortable: false,
                  render: (r) => (
                    <span className="whitespace-nowrap">
                      <span className="block">{when(r.created_at)}</span>
                      <span className="block text-xs text-muted">{timeAgo(r.created_at)}</span>
                    </span>
                  ),
                },
                {
                  key: "actor",
                  header: "Actor",
                  sortable: false,
                  render: (r) => (
                    <span className="whitespace-nowrap">
                      <span className="block">{r.actor_email || "system"}</span>
                      {r.actor_role && <span className="block text-xs text-muted">{r.actor_role}</span>}
                    </span>
                  ),
                },
                { key: "action", header: "Action", sortable: false, render: (r) => <span className="font-mono text-xs">{r.action}</span> },
                {
                  key: "entity",
                  header: "Entity",
                  sortable: false,
                  render: (r) => (
                    <span className="font-mono text-xs text-muted whitespace-nowrap">
                      {r.entity}
                      {r.entity_id != null ? ` #${r.entity_id}` : ""}
                    </span>
                  ),
                },
                {
                  key: "summary",
                  header: "Details",
                  sortable: false,
                  render: (r) => (
                    <span className="block max-w-[260px] truncate text-xs text-muted font-mono" title="Select the row for the full details">
                      {r.details && Object.keys(r.details).length ? JSON.stringify(r.details) : "—"}
                    </span>
                  ),
                },
              ]}
            />
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={setPage} label="entries" />
          </>
        )}
      </Card>

      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.action} subtitle={open && `${when(open.created_at)} · ${open.actor_email || "system"}`}>
        {open && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted">Entry</dt>
              <dd className="font-mono">#{open.log_id}</dd>
              <dt className="text-muted">Entity</dt>
              <dd className="font-mono">
                {open.entity}
                {open.entity_id != null ? ` #${open.entity_id}` : ""}
              </dd>
              <dt className="text-muted">Actor</dt>
              <dd>
                {open.actor_email || "system"}
                {open.actor_user_id != null && <span className="text-muted"> (user #{open.actor_user_id})</span>}
              </dd>
            </dl>
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Details (JSON)</p>
              <pre className="rounded-lg bg-ink text-white/90 text-xs p-4 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(open.details ?? {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </PortalShell>
  );
}
