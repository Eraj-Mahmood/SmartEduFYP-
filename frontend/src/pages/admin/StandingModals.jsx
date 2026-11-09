import { useEffect, useState } from "react";
import client from "../../api/client";
import { Modal, Button, Icons, StandingChip, useToast } from "../../components/ui";

// Record the Principal's approval (through the HoD) for a student on Probation 2 to enrol
// (Handbook 5.5.5). There are no HoD or Principal accounts: the admin records who approved.
export function RecordApprovalModal({ student, onClose, onSaved }) {
  const { toast } = useToast();
  const [role, setRole] = useState("Principal via HoD");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setRole("Principal via HoD");
    setNote("");
    setError("");
  }, [student]);

  async function save() {
    if (role.trim().length < 2) {
      setError("Enter who approved it, e.g. Principal via HoD");
      return;
    }
    setSaving(true);
    try {
      await client.post(`/admin/students/${student.student_id}/enrolment-approval`, { approverRole: role.trim(), note: note.trim() || null });
      toast(`${student.full_name} can now be enrolled.`, { type: "success", title: "Approval recorded" });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || "Could not record the approval");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(student)}
      onClose={onClose}
      title="Record enrolment approval"
      subtitle={student && `${student.full_name} · ${student.roll_no}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} icon={<Icons.Check size={16} />}>
            Record approval
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <StandingChip status="probation_2" />
          <span className="text-sm text-muted">Needs the Principal's prior approval, through the HoD (Handbook 5.5.5).</span>
        </div>
        <div>
          <label htmlFor="ap-role" className="field-label">
            Approved by (role)
          </label>
          <input id="ap-role" className="field" maxLength={100} value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ap-note" className="field-label">
            Note (optional)
          </label>
          <textarea id="ap-note" className="field min-h-[72px]" maxLength={1000} placeholder="e.g. Approved for a reduced load of 3 courses" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
