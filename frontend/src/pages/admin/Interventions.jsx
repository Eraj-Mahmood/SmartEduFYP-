import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell, Card, RiskBadge } from "../../components/Shell";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/interventions", label: "Interventions" },
];

export default function Interventions() {
  const [atRisk, setAtRisk] = useState([]);
  const [form, setForm] = useState({ subject: "", message: "" });
  const [sentTo, setSentTo] = useState(null);

  useEffect(() => {
    client.get("/admin/at-risk-students").then((res) => setAtRisk(res.data));
  }, []);

  async function send(student) {
    if (!form.subject || !form.message) return alert("Subject and message are required");
    await client.post("/admin/notifications", {
      recipient_user_id: student.user_id,
      subject: form.subject,
      message: form.message,
    });
    setSentTo(student.roll_no);
    setTimeout(() => setSentTo(null), 2500);
  }

  return (
    <PortalShell title="Admin" links={LINKS}>
      <h1 className="font-display text-2xl mb-1">Interventions</h1>
      <p className="text-ink/50 text-sm mb-5">Students flagged At-Risk or Dropout-Likely by the helper bot.</p>

      <Card title="Notification template" className="mb-5">
        <div className="grid gap-3">
          <input
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            className="border border-black/10 rounded px-3 py-2"
          />
          <textarea
            placeholder="Message"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            rows={3}
            className="border border-black/10 rounded px-3 py-2"
          />
          <p className="text-xs text-ink/40">Fill this once, then click "Send" next to any student below.</p>
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink/50 border-b border-black/10">
              <th className="py-2">Roll No</th><th>Name</th><th>Risk</th><th>Dropout Prob.</th><th></th>
            </tr>
          </thead>
          <tbody>
            {atRisk.map((s) => (
              <tr key={s.student_id} className="border-b border-black/5">
                <td className="py-2">{s.roll_no}</td>
                <td>{s.full_name}</td>
                <td><RiskBadge label={s.predicted_label} /></td>
                <td>{Math.round((s.prob_dropout || 0) * 100)}%</td>
                <td>
                  <button
                    onClick={() => send(s)}
                    className="text-xs px-3 py-1.5 bg-brand text-white rounded hover:bg-brand-dark transition"
                  >
                    {sentTo === s.roll_no ? "Sent ✓" : "Send"}
                  </button>
                </td>
              </tr>
            ))}
            {atRisk.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-ink/40">No at-risk students flagged yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </PortalShell>
  );
}
