import { Link, useParams } from "react-router-dom";
import useApi from "../../lib/useApi";
import { Button, Icons, EmptyState } from "../../components/ui";

// Print view of one warning letter (Handbook 5.5.2). Opened in a new tab from the admin pages; the
// browser's Print -> Save as PDF keeps a copy on record. No app chrome, so it prints cleanly.
export default function WarningLetterPrint() {
  const { id } = useParams();
  const { data: l, error, loading } = useApi(`/admin/warning-letters/${id}`);

  if (error) return <EmptyState icon={<Icons.AlertOctagon size={22} />} message="We couldn't load this letter" detail={error} />;
  if (loading || !l) return <p className="p-8 text-muted">Loading the letter…</p>;
  return (
    <div className="min-h-screen bg-paper print:bg-white">
      <div className="mx-auto max-w-[780px] px-4 py-6 print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Link to="/admin/academic-standing" className="text-sm text-brand hover:underline">
            ← Academic standing
          </Link>
          <Button onClick={() => window.print()} icon={<Icons.Download size={16} />}>
            Print / Save as PDF
          </Button>
        </div>
        <article className="bg-surface border border-line rounded-card p-8 sm:p-12 text-[15px] leading-relaxed text-ink print:border-0 print:p-0">
          <header className="flex items-start justify-between gap-4 border-b border-line pb-4 mb-6">
            <div>
              <p className="font-display text-xl">Office of the Head of Department</p>
              <p className="text-sm text-muted">{l.student.department}</p>
            </div>
            <p className="text-sm text-right">{l.date}</p>
          </header>
          <p className="mb-4">
            <strong>{l.student.name}</strong>
            <br />
            Roll no {l.student.roll_no} · {l.student.programme}, {l.student.department}
          </p>
          <h1 className="font-display text-lg mb-4">{l.title}</h1>
          <p className="mb-3">Dear {l.student.name},</p>
          <p className="mb-3">{l.body}</p>
          <p className="mb-2">What must happen next semester:</p>
          <ul className="list-disc pl-6 mb-6 space-y-1">
            {l.next_steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mb-10">Term: {l.term} · {l.measure}: {l.cgpa} · Minimum: {l.minimum}</p>
          <div className="grid grid-cols-2 gap-10 mt-12">
            <div>
              <div className="border-t border-ink pt-1 text-sm">{l.signature}</div>
            </div>
            <div>
              <div className="border-t border-ink pt-1 text-sm">Student's signature / acknowledgement</div>
              {l.acknowledged_text && <p className="text-xs text-muted mt-1">{l.acknowledged_text}</p>}
            </div>
          </div>
          <p className="mt-10 text-xs text-muted">Issued under clause 5.5.2 of the BU Student Handbook (Spring 2024). A copy is kept on the student's record.</p>
        </article>
      </div>
    </div>
  );
}
