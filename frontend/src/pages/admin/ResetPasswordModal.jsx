import { useCallback, useRef, useState } from "react";
import client from "../../api/client";
import { Modal, Button, Icons, useToast } from "../../components/ui";
import { loginPathFor } from "../../lib/portals";

/**
 * Admin password reset (PUT /api/admin/users/:userId/reset-password): a confirmation step, then the
 * temporary password in a one-time copy box. The password lives only in this component's state and
 * is cleared when the dialog closes; it can't be shown again.
 * user: {user_id, full_name, email, role} or null (closed).
 */
export default function ResetPasswordModal({ user, onClose }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [temp, setTemp] = useState(null); // {password, active}
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);

  const close = useCallback(() => {
    setTemp(null);
    setError("");
    setCopied(false);
    onClose();
  }, [onClose]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const { data } = await client.put(`/admin/users/${user.user_id}/reset-password`);
      setTemp({ password: data.tempPassword, active: data.user.is_active });
    } catch (e) {
      setError(e.response?.data?.error || "Could not reset the password");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(temp.password);
      setCopied(true);
      toast("Temporary password copied", { type: "success" });
    } catch {
      // clipboard blocked (e.g. not https): select it so Ctrl+C works
      inputRef.current?.select();
      toast("Press Ctrl+C to copy the selected password", { type: "info" });
    }
  }

  if (!user) return null;
  const portalPath = loginPathFor(user.role);

  return (
    <Modal
      open
      onClose={close}
      title={temp ? "Temporary password" : "Reset password?"}
      subtitle={user.full_name ? `${user.full_name} · ${user.email}` : user.email}
      footer={
        temp ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={busy} icon={<Icons.Lock size={16} />}>
              Reset password
            </Button>
          </>
        )
      }
    >
      {!temp ? (
        <div className="space-y-3 text-sm text-ink">
          <p>
            A new temporary password will be generated. Their current password stops working and every device they are signed in
            on is signed out straight away.
          </p>
          <p>At the next sign-in they must choose a new password before they can use SmartEdu.</p>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="flex items-start gap-2 rounded-lg border border-risk/40 bg-risk-50 px-3 py-2 text-ink">
            <Icons.Warning size={16} className="mt-0.5 text-risk-700" />
            <span>
              <strong>Shown only once.</strong> Copy it now and give it to the user privately. Closing this box clears it.
            </span>
          </p>
          <label htmlFor="temp-password" className="field-label">
            Temporary password
          </label>
          <div className="flex gap-2">
            <input
              id="temp-password"
              ref={inputRef}
              readOnly
              value={temp.password}
              onFocus={(e) => e.target.select()}
              className="field font-mono text-base tracking-wider"
              aria-describedby="temp-password-help"
            />
            <Button variant="secondary" onClick={copy} icon={copied ? <Icons.Check size={16} /> : <Icons.Copy size={16} />}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p id="temp-password-help" className="text-muted">
            They sign in at <span className="font-mono text-ink">{portalPath}</span> with {user.email} and this password, then set their
            own.
            {!temp.active && " This account is deactivated: reactivate it first, or the sign-in will be refused."}
          </p>
        </div>
      )}
    </Modal>
  );
}
