import { useState } from "react";
import client from "../../api/client";
import { PortalShell } from "../../components/Shell";
import {
  RiskChip, Card, StatCard, ChartCard, EmptyState, Skeleton, SkeletonCard, Button, useToast, Icons, riskMeta,
} from "../../components/ui";
import { Legend } from "../../components/charts/theme";
import useApi from "../../lib/useApi";
import { timeAgo, gpa, pct, longDate } from "../../lib/format";
import { StandingChart, standingLegend, AttendanceChart, attendanceLegend, MarksChart, marksLegend, TimelineChart } from "./StudentCharts";

const HERO_TONE = {
  safe: "border-l-safe bg-gradient-to-r from-safe-50/80 to-surface",
  risk: "border-l-risk bg-gradient-to-r from-risk-50/80 to-surface",
  danger: "border-l-danger bg-gradient-to-r from-danger-50/80 to-surface",
  neutral: "border-l-brand bg-surface",
};

function StatusHero({ data, steps, refreshing, onRefresh }) {
  const p = data.latestPrediction;
  const meta = riskMeta(p?.final_label);
  return (
    <section aria-labelledby="status-heading" className={`rounded-card border border-line border-l-4 shadow-card ${HERO_TONE[meta.tone]} px-5 py-5 sm:px-6`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-muted mb-2" id="status-heading">
            Your status this term
          </p>
          {p ? <RiskChip label={p.final_label} supportive size="lg" /> : <p className="font-display text-xl">No status yet</p>}
        </div>
        <Button
          variant={p ? "secondary" : "primary"}
          onClick={onRefresh}
          loading={refreshing}
          icon={<Icons.Refresh size={16} />}
          className="self-start"
        >
          {refreshing ? "Checking..." : p ? "Refresh" : "Check my status"}
        </Button>
      </div>

      {p ? (
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">Why</h3>
            <ul className="space-y-1.5">
              {p.reasons.map((r) => (
                <li key={r} className="flex gap-2 text-[15px] leading-snug text-ink/90">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-ink/40 shrink-0" aria-hidden="true" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">What to do next</h3>
            <ol className="space-y-1.5">
              {steps.slice(0, 3).map((s, i) => (
                <li key={s.id} className="flex gap-2 text-[15px] leading-snug text-ink/90">
                  <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-ink/[0.07] text-[11px] font-semibold flex items-center justify-center" aria-hidden="true">
                    {i + 1}
                  </span>
                  {s.text}
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Run a check to see how this term is going, based on your latest marks and attendance.</p>
      )}

      {p && (
        <div className="mt-5 pt-4 border-t border-ink/10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Icons.Clock size={13} /> Updated {timeAgo(p.created_at)}
          </span>
          {p.source === "fallback" && (
            <span className="inline-flex items-center gap-1 text-risk-700">
              <Icons.Info size={13} /> Estimated with rules - the model was unavailable
            </span>
          )}
          {p.policy_reason && <span>Institution policy: {p.policy_reason}</span>}
        </div>
      )}
    </section>
  );
}

function LoadingView() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading your dashboard">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-56 w-full" rounded="rounded-card" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" rounded="rounded-card" />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const { data, error, loading, reload } = useApi("/student/dashboard");
  const timeline = useApi("/student/prediction/timeline");
  const next = useApi("/student/next-steps");
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  async function refresh() {
    setRefreshing(true);
    const before = data?.latestPrediction?.final_label;
    try {
      const { data: p } = await client.post("/student/prediction/refresh");
      await Promise.all([reload({ quiet: true }), timeline.reload({ quiet: true }), next.reload({ quiet: true })]);
      if (before && before !== p.final_label) {
        toast(`Your status changed: ${riskMeta(before).supportive} → ${riskMeta(p.final_label).supportive}`, { type: "info" });
      } else {
        toast("Your status is up to date", { type: "success", duration: 3000 });
      }
    } catch (e) {
      toast(e.response?.data?.error || "Could not refresh your status. Please try again.", { type: "error" });
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !data) return <PortalShell><LoadingView /></PortalShell>;
  if (error && !data) {
    return (
      <PortalShell>
        <Card>
          <EmptyState
            icon={<Icons.AlertOctagon size={22} />}
            message="We couldn't load your dashboard"
            detail={error}
            action={<Button variant="secondary" onClick={() => reload()}>Try again</Button>}
          />
        </Card>
      </PortalShell>
    );
  }

  const { profile, thresholds: t, courses } = data;
  const projected = data.projectedCgpa;
  const delta = projected && data.officialCgpa.value != null ? projected.value - data.officialCgpa.value : null;
  const att = data.liveAttendance;
  const attTone = att?.value == null ? undefined : att.value < t.severe_attendance_pct ? "danger" : att.value < t.min_attendance_pct ? "risk" : "safe";
  const projTone = projected?.value == null ? undefined : projected.value < t.probation_cgpa ? "danger" : projected.value < t.at_risk_cgpa ? "risk" : "safe";
  const points = timeline.data || [];

  return (
    <PortalShell>
      <div className="mb-5">
        <p className="text-sm text-muted">Welcome back</p>
        <h1 className="font-display text-2xl sm:text-[28px] leading-tight">{profile.full_name}</h1>
        <p className="text-muted text-sm mt-1">
          {profile.department} · Semester {profile.current_semester} · {profile.roll_no}
        </p>
      </div>

      <div className="space-y-5">
        <StatusHero data={data} steps={next.data || []} refreshing={refreshing} onRefresh={refresh} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label={data.officialCgpa.label} value={gpa(data.officialCgpa.value)} sublabel="Last completed term" info={data.officialCgpa.note} />
          <StatCard
            label="Projected CGPA"
            value={gpa(projected?.value)}
            tone={projTone}
            info={`${projected?.note || "Appears after your first status check."} It is an estimate, not your official CGPA.`}
            trend={
              delta != null && projected.source === "projected"
                ? { direction: delta > 0.004 ? "up" : delta < -0.004 ? "down" : "flat", text: `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)} vs official`, tone: delta > 0.004 ? "good" : delta < -0.004 && projected.value < t.at_risk_cgpa ? "bad" : "neutral" }
                : undefined
            }
          />
          <StatCard
            label={att.source === "live" ? "Attendance this term" : "Attendance (record)"}
            value={pct(att.value)}
            tone={attTone}
            sublabel={att.source === "live" ? `${att.present} of ${att.sessions} classes` : "No classes marked yet"}
          />
          <StatCard
            label="Courses at risk"
            value={courses.length ? data.coursesBelowPassMark : "—"}
            tone={!courses.length ? undefined : data.coursesBelowPassMark > 0 ? "danger" : "safe"}
            sublabel={courses.length ? `of ${courses.length} below the pass mark (${t.pass_mark})` : "No courses this term"}
            info={`Courses where your average mark is below the pass mark (${t.pass_mark}).`}
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <ChartCard
            title="Where you stand"
            subtitle="Last term, this term so far, and where your CGPA is heading"
            empty={!projected}
            emptyMessage="Check your status to see where you stand"
            height={250}
            footer={<Legend items={standingLegend(t)} />}
          >
            <StandingChart previous={data.previousSgpa?.value} provisional={data.provisionalSgpa?.value} projected={projected?.value} thresholds={t} />
          </ChartCard>

          <ChartCard
            title="Attendance by course"
            subtitle={`Aim for ${t.min_attendance_pct}% or more in every course`}
            empty={!courses.some((c) => c.attendance_pct != null)}
            emptyMessage="No attendance marked yet this term"
            height={Math.max(170, courses.length * 46 + 40)}
            footer={<Legend items={attendanceLegend(t)} />}
          >
            <AttendanceChart courses={courses} thresholds={t} />
          </ChartCard>
        </div>

        <ChartCard
          title="Marks by course"
          subtitle={data.weakestCourse ? `${data.weakestCourse.course_code} has your lowest average - that's where extra effort pays off most` : "Your marks this term"}
          empty={!courses.some((c) => c.mean != null)}
          emptyMessage="No marks entered yet this term"
          emptyDetail="Your teachers' marks will appear here as they are entered."
          height={280}
          footer={<Legend items={marksLegend(t.pass_mark)} />}
        >
          <MarksChart courses={courses} weakestCode={data.weakestCourse?.course_code} passMark={t.pass_mark} />
        </ChartCard>

        {/* The chart only earns its space once the label has changed; until then one line says it all. */}
        {data.latestPrediction?.label_ever_changed ? (
          <ChartCard
            title="Your status over time"
            subtitle="Last 30 days, one point per day"
            loading={timeline.loading && !timeline.data}
            empty={points.length < 2}
            emptyMessage="Your timeline fills in as your marks are updated"
            emptyDetail="New points appear when your status is re-checked on another day."
            height={200}
          >
            <TimelineChart points={points} />
          </ChartCard>
        ) : (
          data.latestPrediction && (
            <p className="flex items-center gap-2 text-sm text-muted px-1">
              <Icons.Clock size={14} />
              Your status has been “{riskMeta(data.latestPrediction.final_label).supportive}” since{" "}
              {longDate(data.latestPrediction.status_since || data.latestPrediction.created_at)}.
            </p>
          )
        )}
      </div>

      {/* Phase 3: assistant chat panel mounts here */}
      <aside id="assistant-panel-slot" hidden aria-hidden="true" />
    </PortalShell>
  );
}
