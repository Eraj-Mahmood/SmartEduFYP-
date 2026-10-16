import { Link } from "react-router-dom";
import { PortalShell } from "../../components/Shell";
import { Card, StatCard, ChartCard, DataTable, EmptyState, Skeleton, Button, Icons } from "../../components/ui";
import { Legend } from "../../components/charts/theme";
import useApi from "../../lib/useApi";
import { timeAgo } from "../../lib/format";
import { RiskDonut, DepartmentRiskChart, stackLegend } from "./AdminCharts";
import RunPredictionsCard from "./RunPredictionsCard";
import RiskBar from "../faculty/RiskBar";

const STATUS_STYLE = {
  completed: "bg-safe-50 text-safe-700 ring-safe-500/30",
  running: "bg-brand-50 text-brand ring-brand/30",
  queued: "bg-brand-50 text-brand ring-brand/30",
  failed: "bg-danger-50 text-danger-700 ring-danger-500/30",
};

function duration(secs) {
  if (secs == null) return "—";
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default function AdminDashboard() {
  const dash = useApi("/admin/dashboard");
  const runs = useApi("/admin/predictions/runs", { params: { limit: 10 } });

  function refreshAll() {
    dash.reload({ quiet: true });
    runs.reload({ quiet: true });
  }

  if (dash.error && !dash.data) {
    return (
      <PortalShell>
        <Card>
          <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load the overview" detail={dash.error} action={<Button variant="secondary" onClick={() => dash.reload()}>Try again</Button>} />
        </Card>
      </PortalShell>
    );
  }

  const d = dash.data;
  const k = d?.kpis;
  const trendById = Object.fromEntries((d?.runsTrend || []).map((r) => [r.id, r]));
  const flaggedPct = k && k.predicted ? Math.round((100 * k.flagged) / k.predicted) : 0;

  return (
    <PortalShell>
      <div className="mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl sm:text-[28px] leading-tight">Institution overview</h1>
          <p className="text-sm text-muted mt-1">Every figure uses each student's latest prediction.</p>
        </div>
        <Link to="/admin/interventions" className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icons.Send size={15} /> Review flagged students
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        {k ? (
          <>
            <StatCard label="Students" value={k.students.toLocaleString()} icon={<Icons.Users size={14} />} />
            <StatCard label="Faculty" value={k.faculty} />
            <StatCard label="Courses" value={k.courses} icon={<Icons.Book size={14} />} />
            <StatCard label="Flagged" value={k.flagged.toLocaleString()} tone="danger" sublabel={`${flaggedPct}% of students`} />
            <StatCard
              label="Last run"
              value={k.lastRun ? timeAgo(k.lastRun.finished_at || k.lastRun.started_at) : "Never"}
              sublabel={k.lastRun ? `#${k.lastRun.id} · ${k.lastRun.status} · ${k.lastRun.done.toLocaleString()} done` : "No batch runs yet"}
              icon={<Icons.Clock size={14} />}
              className="col-span-2 md:col-span-1 [&_.font-display]:text-[22px]"
            />
          </>
        ) : (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className={`h-[108px] ${i === 4 ? "col-span-2 md:col-span-1" : ""}`} rounded="rounded-card" />)
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <Card title="Risk across all students" subtitle="Latest label per student">
          {d ? d.kpis.predicted ? <RiskDonut counts={d.riskCounts} /> : <EmptyState message="No predictions yet" detail="Start a run to score every student." compact /> : <Skeleton className="h-[190px]" />}
        </Card>
        <ChartCard
          title="Risk by department"
          subtitle="Number of students per latest label"
          loading={!d}
          empty={d && !d.kpis.predicted}
          height={240}
          footer={<Legend items={stackLegend} />}
        >
          {d && <DepartmentRiskChart rows={d.riskByDepartment} />}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <RunPredictionsCard activeRun={k?.lastRun} onFinished={refreshAll} />
        </div>
        <Card title="Recent runs" subtitle="Newest first" className="lg:col-span-3">
          <DataTable
            loading={runs.loading && !runs.data}
            rows={runs.data || []}
            rowKey={(r) => r.id}
            minWidth={560}
            emptyMessage="No batch runs yet"
            initialSort={{ key: "started_at", dir: "desc" }}
            columns={[
              { key: "started_at", header: "Started", sortValue: (r) => new Date(r.started_at).getTime(), render: (r) => (
                  <span className="whitespace-nowrap">
                    {timeAgo(r.started_at)}
                    <span className="block text-xs text-muted">took {duration(r.duration_seconds)}</span>
                  </span>
                ),
              },
              { key: "scope_name", header: "Scope", className: "whitespace-nowrap" },
              {
                key: "status",
                header: "Status",
                render: (r) => <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}>{r.status}</span>,
              },
              {
                key: "done",
                header: "Done / failed",
                align: "right",
                render: (r) => (
                  <span className="whitespace-nowrap tabular-nums">
                    {r.done.toLocaleString()} / <span className={r.failed ? "text-danger-700 font-medium" : "text-muted"}>{r.failed.toLocaleString()}</span>
                  </span>
                ),
              },
              {
                key: "result",
                header: "Result",
                sortable: false,
                render: (r) => (trendById[r.id] ? <div className="w-24"><RiskBar counts={trendById[r.id]} showText={false} /></div> : "—"),
              },
            ]}
          />
        </Card>
      </div>
    </PortalShell>
  );
}
