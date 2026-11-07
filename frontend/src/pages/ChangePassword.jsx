import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PortalShell } from "../components/Shell";
import { Button, Icons, useToast } from "../components/ui";

// Change password. Forced (must_reset_pw, e.g. an account an admin just created): shown on its
// own before anything else, with only "Log out" as a way out. Voluntary: from the account menu,
// inside the normal portal.

const RULES = [
  { id: "len", text: "At least 8 characters", test: (p) => p.length >= 8 },
  { id: "upper", text: "An upper-case letter (A-Z)", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", text: "A lower-case letter (a-z)", test: (p) => /[a-z]/.test(p) },
  { id: "digit", text: "A digit (0-9)", test: (p) => /[0-9]/.test(p) },
];

/** A rough strength hint: the rules plus length and a symbol. */
function strength(p) {
  if (!p) return null;
  let s = RULES.filter((r) => r.test(p)).length;
  if (p.length >= 12) s += 1;
  if (/[^A-Za-z0-9]/.test(p)) s += 1;
  if (s <= 2) return { label: "Weak", tone: "bg-danger", width: "w-1/4", text: "text-danger" };
  if (s <= 4) return { label: "Fair", tone: "bg-risk", width: "w-2/4", text: "text-risk-700" };
  if (s === 5) return { label: "Good", tone: "bg-safe", width: "w-3/4", text: "text-safe-700" };
  return { label: "Strong", tone: "bg-safe", width: "w-full", text: "text-safe-700" };
}

function PasswordField({ id, label, value, onChange, autoComplete, describedBy }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          className="field pr-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          required
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted hover:text-ink hover:bg-ink/5"
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={show}
        >
          {show ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
        </button>
      </div>
    </div>
  );
}

function ChangePasswordForm({ forced }) {
  const { completePasswordChange, logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const passed = RULES.map((r) => ({ ...r, ok: r.test(next) }));
  const allOk = passed.every((r) => r.ok);
  const same = next && current && next === current;
  const mismatch = confirm && next !== confirm;
  const ready = current && allOk && !same && next === confirm;
  const hint = strength(next);

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await client.post("/auth/change-password", { currentPassword: current, newPassword: next });
      completePasswordChange(data.token);
      toast("Your password has been changed", { type: "success" });
      navigate(`/${data.role}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Could not change your password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <PasswordField id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordField id="new-password" label="New password" value={next} onChange={setNext} autoComplete="new-password" describedBy="password-rules" />

      {hint && (
        <div aria-live="polite">
          <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
            <div className={`h-full ${hint.tone} ${hint.width} transition-all`} />
          </div>
          <p className={`mt-1 text-xs ${hint.text}`}>Strength: {hint.label}</p>
        </div>
      )}

      <ul id="password-rules" className="grid gap-1 sm:grid-cols-2 text-sm" aria-label="Password rules">
        {passed.map((r) => (
          <li key={r.id} className={`flex items-center gap-1.5 ${r.ok ? "text-safe-700" : "text-muted"}`}>
            {r.ok ? <Icons.CheckCircle size={15} /> : <span className="h-[15px] w-[15px] rounded-full border border-current shrink-0" aria-hidden="true" />}
            <span>
              {r.text}
              <span className="sr-only">{r.ok ? " - done" : " - not yet"}</span>
            </span>
          </li>
        ))}
        <li className={`flex items-center gap-1.5 ${next && !same ? "text-safe-700" : "text-muted"}`}>
          {next && !same ? <Icons.CheckCircle size={15} /> : <span className="h-[15px] w-[15px] rounded-full border border-current shrink-0" aria-hidden="true" />}
          Different from your current password
        </li>
      </ul>

      <PasswordField id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      {mismatch && <p className="text-sm text-danger -mt-2">The two new passwords don't match.</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {forced ? (
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
            className="text-sm text-muted hover:text-ink hover:underline"
          >
            Log out
          </button>
        ) : (
          <button type="button" onClick={() => navigate(-1)} className="text-sm text-muted hover:text-ink hover:underline">
            Cancel
          </button>
        )}
        <Button type="submit" loading={saving} disabled={!ready} icon={<Icons.Lock size={16} />}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export default function ChangePassword() {
  const { mustReset } = useAuth();
  if (!localStorage.getItem("smartedu_token")) return <Navigate to="/login" replace />;

  if (mustReset) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="font-display text-3xl text-white tracking-tight">SmartEdu</h1>
          </div>
          <div className="bg-surface rounded-2xl p-6 shadow-xl">
            <h2 className="font-display text-xl text-ink">Set a new password</h2>
            <p className="text-sm text-muted mt-1 mb-5">
              Your account was set up with a temporary password. Choose your own before you continue.
            </p>
            <ChangePasswordForm forced />
          </div>
        </div>
      </div>
    );
  }
  return (
    <PortalShell>
      <div className="max-w-lg">
        <h1 className="font-display text-2xl sm:text-[28px] mb-1">Change password</h1>
        <p className="text-muted text-sm mb-5">You'll stay signed in on this device.</p>
        <div className="bg-surface rounded-card border border-line shadow-card p-5">
          <ChangePasswordForm forced={false} />
        </div>
      </div>
    </PortalShell>
  );
}
