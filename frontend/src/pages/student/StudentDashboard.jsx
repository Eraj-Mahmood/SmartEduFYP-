import { useEffect, useState } from "react";
import client from "../../api/client";
import { PortalShell, Card, RiskBadge } from "../../components/Shell";

const LINKS = [
  { href: "/student", label: "Overview" },
  { href: "/student/results", label: "Results" },
  { href: "/student/attendance", label: "Attendance" },
];

export default function StudentDashboard() {
  const [data, setData] = useState(null);
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState(null);

  useEffect(() => {
    client.get("/student/dashboard").then((res) => setData(res.data));
  }, []);

  async function runHelperBot() {
    setPredicting(true);
    try {
      const { data } = await client.post("/student/prediction/refresh");
      setPrediction(data);
    } catch (e) {
      alert(e.response?.data?.error || "Prediction failed");
    } finally {
      setPredicting(false);
    }
  }

  if (!data) return <PortalShell title="Student" links={LINKS}><p>Loading...</p></PortalShell>;

  const { profile, latestPrediction, averageAttendance } = data;
  const shown = prediction || latestPrediction;

  return (
    <PortalShell title="Student" links={LINKS}>
      <div className="mb-6">
        <h1 className="font-display text-2xl">Welcome back, {profile?.full_name}</h1>
        <p className="text-ink/50 text-sm">{profile?.department} · Semester {profile?.current_semester} · Roll No {profile?.roll_no}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        <Card title="CGPA">
          <p className="text-4xl font-display">{profile?.cgpa ?? "—"}</p>
        </Card>
        <Card title="Average Attendance">
          <p className="text-4xl font-display">{averageAttendance ?? "—"}%</p>
        </Card>
        <Card title="Scholarship / Hostel">
          <p className="text-lg">{profile?.scholarship} · {profile?.hostel}</p>
        </Card>
      </div>

      <Card title="Helper Bot — Performance Prediction">
        {shown && !shown.message ? (
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <RiskBadge label={shown.predicted_label} />
              <p className="text-sm text-ink/50 mt-2">
                Safe {Math.round((shown.prob_safe || 0) * 100)}% · At-Risk {Math.round((shown.prob_at_risk || 0) * 100)}% · Dropout {Math.round((shown.prob_dropout || 0) * 100)}%
              </p>
            </div>
            <button
              onClick={runHelperBot}
              disabled={predicting}
              className="px-4 py-2 bg-brand text-white rounded hover:bg-brand-dark transition disabled:opacity-60"
            >
              {predicting ? "Running model..." : "Refresh prediction"}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-ink/60 text-sm">No prediction yet. Run the model on your latest semester data.</p>
            <button
              onClick={runHelperBot}
              disabled={predicting}
              className="px-4 py-2 bg-brand text-white rounded hover:bg-brand-dark transition disabled:opacity-60"
            >
              {predicting ? "Running model..." : "Predict my outcome"}
            </button>
          </div>
        )}
      </Card>
    </PortalShell>
  );
}
