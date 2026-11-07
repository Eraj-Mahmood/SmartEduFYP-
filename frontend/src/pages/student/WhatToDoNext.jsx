import { Card, Icons, buttonClass } from "../../components/ui";
import { timeAgo } from "../../lib/format";

// "What to do next" on the student dashboard: who to talk to (their counselor), what to study
// (the recommended tutorial for their weakest course) and the ranked next steps.

const KIND_LABEL = { video: "Video lectures", notes: "Notes & readings", practice: "Practice" };

function CounselorCard({ counselor }) {
  if (!counselor) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface/60 p-4">
        <p className="text-xs font-mono uppercase tracking-wider text-muted">Your counselor</p>
        <p className="mt-1.5 text-sm text-muted">No counselor is assigned to you yet. Ask SmartEdu "Who can help me?" for support contacts.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-mono uppercase tracking-wider text-muted">Your counselor</p>
      <div className="mt-2 flex items-start gap-3">
        <span className="h-10 w-10 shrink-0 rounded-full bg-brand-50 text-brand flex items-center justify-center" aria-hidden="true">
          <Icons.UserCheck size={20} />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-ink">{counselor.name}</p>
          <p className="text-sm text-muted">
            {counselor.designation || "Faculty"}
            {counselor.department ? ` · ${counselor.department}` : ""}
          </p>
          <a href={`mailto:${counselor.email}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-brand hover:underline break-all">
            <Icons.Mail size={14} /> {counselor.email}
          </a>
          <p className="text-xs text-muted mt-1">Assigned {timeAgo(counselor.assigned_at)}</p>
        </div>
      </div>
    </div>
  );
}

function TutorialCard({ recommendation }) {
  const { course, tutorial, reason } = recommendation;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-mono uppercase tracking-wider text-muted">Study next · {course.course_code}</p>
      {tutorial ? (
        <>
          <p className="mt-1.5 font-medium text-ink">{tutorial.title}</p>
          <p className="text-sm text-muted">
            {tutorial.provider}
            {tutorial.kind ? ` · ${KIND_LABEL[tutorial.kind] || tutorial.kind}` : ""}
          </p>
          <p className="mt-2 text-sm text-ink/90">{reason}.</p>
          <a href={tutorial.url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm", "mt-3")}>
            <Icons.External size={14} /> Open tutorial
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </>
      ) : (
        <p className="mt-1.5 text-sm text-muted">
          {reason}. There's no study material for {course.course_code} yet - ask your teacher what to review.
        </p>
      )}
    </div>
  );
}

export default function WhatToDoNext({ counselor, recommendation, steps, flagged }) {
  // the tutorial has its own card, so its step isn't repeated in the list
  const list = steps.filter((s) => s.id !== "tutorial" || !recommendation?.tutorial);
  const side = recommendation || counselor || flagged;
  return (
    <Card title="What to do next" subtitle="Your steps, who can help, and what to study" as="section">
      <div id="what-next" className={`scroll-mt-28 grid gap-5 ${side ? "lg:grid-cols-[1.4fr_1fr]" : ""}`}>
        <div>
          {list.length ? (
            <ol className="space-y-2.5">
              {list.map((s, i) => (
                <li key={s.id} className="flex gap-2.5 text-[15px] leading-snug text-ink/90">
                  <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-brand-50 text-brand text-xs font-semibold flex items-center justify-center" aria-hidden="true">
                    {i + 1}
                  </span>
                  {s.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Nothing urgent - keep attending every class and submitting work on time.</p>
          )}
        </div>
        {side && (
          <div className="space-y-3">
            <CounselorCard counselor={counselor} />
            {recommendation && <TutorialCard recommendation={recommendation} />}
          </div>
        )}
      </div>
    </Card>
  );
}
