// TEMPORARY: component gallery for Phase 2 review. Delete this file and its /ui-kit route
// before the final commit of the phase.
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
import {
  RiskChip, Card, StatCard, ChartCard, EmptyState, Skeleton, SkeletonText, SkeletonCard,
  useToast, Drawer, DataTable, Pagination, Button, Tooltip, Icons, chart,
} from "../components/ui";

const ROWS = [
  { roll: "BU-100040", name: "Student 100040", label: "Safe", cgpa: 2.94, att: 100 },
  { roll: "BU-122785", name: "Student 122785", label: "At-Risk", cgpa: 1.98, att: 78.1 },
  { roll: "BU-144766", name: "Student 144766", label: "Dropout-Likely", cgpa: 1.54, att: 65.6 },
  { roll: "BU-112907", name: "Student 112907", label: "At-Risk", cgpa: 2.23, att: 81.3 },
];
const SEV = { Safe: 0, "At-Risk": 1, "Dropout-Likely": 2 };

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="font-mono text-xs uppercase tracking-wider text-muted">{title}</h2>
      {children}
    </section>
  );
}

export default function UiKit() {
  const { toast } = useToast();
  const [drawer, setDrawer] = useState(false);
  const [page, setPage] = useState(1);

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-ink text-white px-6 py-4">
        <span className="font-display text-xl">SmartEdu</span> <span className="text-white/60 text-sm">UI kit (temporary)</span>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        <Section title="RiskChip">
          <div className="flex flex-wrap items-center gap-3">
            {["Safe", "At-Risk", "Dropout-Likely"].map((l) => (
              <RiskChip key={l} label={l} />
            ))}
            <RiskChip label="At-Risk" size="sm" />
            <RiskChip label="Dropout-Likely" size="lg" />
            <RiskChip label="Dropout-Likely" short />
            <RiskChip label={null} />
          </div>
          <div className="flex flex-wrap gap-6">
            {["Safe", "At-Risk", "Dropout-Likely"].map((l) => (
              <RiskChip key={l} label={l} supportive size="lg" />
            ))}
          </div>
        </Section>

        <Section title="StatCard">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label="Official CGPA" value="1.62" sublabel="From your record" />
            <StatCard
              label="Projected CGPA"
              value="1.54"
              tone="danger"
              trend={{ direction: "down", text: "−0.08", tone: "bad" }}
              info="Projected from this term's marks so far. It becomes official when results are finalised."
            />
            <StatCard label="Attendance" value="65.6%" tone="risk" sublabel="below 75%" />
            <StatCard label="Courses at risk" value="0" tone="safe" trend={{ direction: "flat", text: "none", tone: "good" }} />
          </div>
        </Section>

        <Section title="ChartCard + EmptyState + Skeleton">
          <div className="grid md:grid-cols-3 gap-4">
            <ChartCard title="Marks by course" subtitle="Mean of four components" height={200}>
              <ResponsiveContainer>
                <BarChart data={[{ c: "AI301", v: 62 }, { c: "AI302", v: 61 }, { c: "AI401", v: 57 }]}>
                  <CartesianGrid stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="c" tick={{ fontSize: 12, fill: chart.axis }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: chart.axis }} width={32} />
                  <RTooltip />
                  <Bar dataKey="v" fill={chart.series[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Risk timeline" empty emptyMessage="Your timeline fills in as your marks are updated" emptyDetail="Check back after your next result." height={200} />
            <ChartCard title="Loading chart" loading height={200} />
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <Card title="EmptyState">
              <EmptyState message="No students need attention" detail="Everyone in this class is on track." action={{ label: "View all students", onClick: () => toast("Action clicked") }} compact />
            </Card>
            <Card title="Skeleton">
              <SkeletonText lines={4} />
              <Skeleton className="h-9 w-32 mt-4" rounded="rounded-lg" />
            </Card>
            <SkeletonCard height="h-24" />
          </div>
        </Section>

        <Section title="Toast, Drawer, Button, Tooltip">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => toast("BU-112907: At-Risk → Safe", { type: "success", title: "Prediction updated" })}>Success toast</Button>
            <Button variant="secondary" onClick={() => toast("Attendance saved: 7 present, 1 absent", { type: "info" })}>Info toast</Button>
            <Button variant="secondary" onClick={() => toast("Could not save marks", { type: "error" })}>Error toast</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
            <Button loading>Saving</Button>
            <Button variant="ghost" icon={<Icons.Refresh size={16} />}>Ghost</Button>
            <Tooltip content="Projected = what your CGPA will be if this term ends with today's marks.">
              <button className="text-sm underline decoration-dotted">Hover or tap me</button>
            </Tooltip>
          </div>
          <Drawer open={drawer} onClose={() => setDrawer(false)} title="Student 122785" subtitle="BU-122785 · AI301">
            <RiskChip label="At-Risk" />
            <ul className="mt-4 space-y-2 text-sm list-disc pl-5">
              <li>Your CGPA (1.98) is below 2.00.</li>
              <li>You have submitted only 70.1% of your assignments.</li>
            </ul>
          </Drawer>
        </Section>

        <Section title="DataTable (sortable, scrolls inside its card)">
          <Card title="Roster" subtitle="Click a header to sort; click a row">
            <DataTable
              rowKey={(r) => r.roll}
              initialSort={{ key: "label", dir: "desc" }}
              onRowClick={(r) => toast(`Clicked ${r.roll}`)}
              columns={[
                { key: "roll", header: "Roll no", className: "font-mono text-xs" },
                { key: "name", header: "Name" },
                { key: "label", header: "Risk", sortValue: (r) => SEV[r.label], render: (r) => <RiskChip label={r.label} size="sm" /> },
                { key: "cgpa", header: "Projected CGPA", align: "right", render: (r) => r.cgpa.toFixed(2) },
                { key: "att", header: "Attendance", align: "right", render: (r) => `${r.att}%` },
              ]}
              rows={ROWS}
            />
            <Pagination page={page} totalPages={5} total={120} onPage={setPage} label="students" />
          </Card>
          <Card title="Empty table">
            <DataTable columns={[{ key: "a", header: "Name" }, { key: "b", header: "Risk" }]} rows={[]} emptyMessage="No students match these filters" minWidth={300} />
          </Card>
        </Section>
      </main>
    </div>
  );
}
