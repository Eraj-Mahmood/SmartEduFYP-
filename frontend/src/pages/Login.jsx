import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PORTALS, loginPathFor } from "../lib/portals";
import { PORTAL_ICONS, signedInHome } from "./PortalChooser";
import { ChevronRight, Warning } from "../components/ui/icons";

/** One sign-in page per portal (/login/student, /login/faculty, /login/admin). */
export default function Login({ portal }) {
  const p = PORTALS[portal];
  const Icon = PORTAL_ICONS[portal];
  const location = useLocation();
  // a wrong-portal redirect carries the email over so it doesn't have to be typed again
  const [email, setEmail] = useState(location.state?.email || "");
  const [password, setPassword] = useState("");
  // e.g. "This account has been deactivated" after the server rejected a session token.
  // Read in the initializer, removed after mount (StrictMode runs initializers twice).
  const [error, setError] = useState(() => {
    try {
      return sessionStorage.getItem("smartedu_login_notice") || "";
    } catch {
      return "";
    }
  });
  const [wrongPortal, setWrongPortal] = useState(null); // {message, correctPortal}
  useEffect(() => {
    try {
      sessionStorage.removeItem("smartedu_login_notice");
    } catch {
      /* storage unavailable */
    }
  }, []);
  // a new portal (wrong-portal button) starts clean
  useEffect(() => {
    setWrongPortal(null);
    setPassword("");
  }, [portal]);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const home = signedInHome();
  if (home) return <Navigate to={home} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setWrongPortal(null);
    setLoading(true);
    try {
      const data = await login(email, password, portal);
      // the server checked the portal; a temporary password must be changed first
      navigate(data.mustResetPassword ? "/change-password" : `/${data.role}`, { replace: true });
    } catch (err) {
      const body = err.response?.data;
      if (body?.code === "WRONG_PORTAL" && PORTALS[body.correctPortal]) {
        setWrongPortal({ message: body.error, correctPortal: body.correctPortal });
      } else {
        setError(body?.error || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-5 py-10">
      <main className="w-full max-w-sm">
        <div className="text-center mb-6">
          <Link to="/" className="font-display text-3xl text-white tracking-tight hover:opacity-90">
            SmartEdu
          </Link>
          <p className="text-white/75 text-sm mt-1 font-mono">Predictive Analytics for Student Retention</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface rounded-xl p-6 shadow-xl space-y-4"
          style={{ borderTop: `4px solid ${p.accent}` }}
          aria-labelledby="login-title"
        >
          <div className="flex items-center gap-3">
            <span className="h-10 w-10 rounded-full flex items-center justify-center" style={{ background: p.tint, color: p.accent }}>
              <Icon size={20} />
            </span>
            <h1 id="login-title" className="font-display text-2xl text-ink">
              {p.title}
            </h1>
          </div>
          <p className="text-sm text-muted">{p.hint}</p>

          <div>
            <label htmlFor="login-email" className="field-label">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field py-2.5"
              placeholder={p.placeholder}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="field-label">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field py-2.5"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}

          {wrongPortal && (
            <div role="alert" className="rounded-lg border border-risk/40 bg-risk-50 p-3 text-sm text-ink">
              <p className="flex gap-2">
                <Warning size={18} className="text-risk-700 mt-px" />
                <span>{wrongPortal.message}</span>
              </p>
              <button
                type="button"
                onClick={() => navigate(loginPathFor(wrongPortal.correctPortal), { state: { email } })}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2 px-3 text-white font-medium hover:opacity-90"
                style={{ background: PORTALS[wrongPortal.correctPortal].accent }}
              >
                Go to {PORTALS[wrongPortal.correctPortal].name} sign in <ChevronRight size={16} />
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white rounded-lg py-2.5 font-medium transition hover:opacity-90 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ background: p.accent }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>

          <p className="text-sm text-muted text-center pt-1">
            {p.notYou}{" "}
            <Link to="/" className="font-medium underline underline-offset-2 hover:text-ink" style={{ color: p.accentDark }}>
              Choose another portal
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
