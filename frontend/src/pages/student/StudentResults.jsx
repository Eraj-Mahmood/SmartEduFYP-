import { PortalShell } from "../../components/Shell";
import { Card, DataTable, EmptyState, Button, Icons } from "../../components/ui";
import useApi from "../../lib/useApi";
import { num } from "../../lib/format";

const mark = (key, header) => ({ key, header, align: "right", render: (r) => num(r[key]), sortValue: (r) => (r[key] == null ? null : Number(r[key])) });

export default function StudentResults() {
  const { data, error, loading, reload } = useApi("/student/results");
  const rows = data || [];

  return (
    <PortalShell>
      <h1 className="font-display text-2xl sm:text-[28px] mb-5">My results</h1>
      <Card title="Course results" subtitle="Marks out of 100 for each assessment">
        {error ? (
          <EmptyState
            icon={<Icons.AlertOctagon size={22} />}
            message="We couldn't load your results"
            detail={error}
            action={<Button variant="secondary" onClick={() => reload()}>Try again</Button>}
          />
        ) : (
          <DataTable
            loading={loading}
            rows={rows}
            rowKey={(r) => `${r.course_code}-${r.semester}`}
            initialSort={{ key: "course", dir: "asc" }}
            emptyMessage="No results recorded yet"
            minWidth={680}
            columns={[
              {
                key: "course",
                header: "Course",
                sortValue: (r) => r.course_code,
                render: (r) => (
                  <span>
                    <span className="font-medium">{r.course_code}</span>
                    <span className="block text-xs text-muted">{r.title}</span>
                  </span>
                ),
              },
              { key: "semester", header: "Semester", align: "right" },
              mark("assignment_avg", "Assignment"),
              mark("quiz_avg", "Quiz"),
              mark("midterm_marks", "Midterm"),
              mark("final_marks", "Final"),
              {
                key: "grade",
                header: "Grade",
                align: "center",
                render: (r) =>
                  r.grade ? (
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink/[0.06] font-semibold">{r.grade}</span>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        )}
      </Card>
    </PortalShell>
  );
}
