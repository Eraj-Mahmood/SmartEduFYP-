import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(email, password);
      // This is the "verification" step: role from the server decides the portal.
      navigate(`/${data.role}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl text-white tracking-tight">SmartEdu</h1>
          <p className="text-white/50 text-sm mt-1 font-mono">Predictive Analytics for Student Retention</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg p-6 shadow-xl space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink/70 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-black/10 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="you@smartedu.edu"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink/70 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-black/10 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand hover:bg-brand-dark text-white rounded py-2.5 font-medium transition disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>

          <p className="text-xs text-ink/40 text-center pt-2">
            Students, faculty, and admin all sign in here — you'll be routed to your portal automatically.
          </p>
        </form>
      </div>
    </div>
  );
}
