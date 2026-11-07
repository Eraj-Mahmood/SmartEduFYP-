import { Link, Navigate } from "react-router-dom";
import { PORTALS, loginPathFor } from "../lib/portals";
import { Book, Users, Lock, ChevronRight } from "../components/ui/icons";

export const PORTAL_ICONS = { student: Book, faculty: Users, admin: Lock };

/** Where a signed-in user belongs, or null when nobody is signed in. */
export function signedInHome() {
  const token = localStorage.getItem("smartedu_token");
  const role = localStorage.getItem("smartedu_role");
  if (!token || !PORTALS[role]) return null;
  return localStorage.getItem("smartedu_must_reset") === "1" ? "/change-password" : `/${role}`;
}

function PortalCard({ portal }) {
  const p = PORTALS[portal];
  const Icon = PORTAL_ICONS[portal];
  return (
    <div className="bg-surface rounded-xl shadow-xl overflow-hidden flex flex-col" style={{ borderTop: `4px solid ${p.accent}` }}>
      <div className="p-6 flex-1 flex flex-col">
        <span className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: p.tint, color: p.accent }}>
          <Icon size={24} />
        </span>
        <h2 className="mt-4 font-display text-2xl text-ink">{p.name}</h2>
        <p className="mt-1 text-sm text-muted flex-1">{p.description}</p>
        <Link
          to={loginPathFor(portal)}
          className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 px-4 text-white font-medium transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ background: p.accent }}
          aria-label={`${p.name} sign in`}
        >
          Sign in <ChevronRight size={16} />
        </Link>
      </div>
    </div>
  );
}

export default function PortalChooser() {
  const home = signedInHome();
  if (home) return <Navigate to={home} replace />;
  const admin = PORTALS.admin;
  const AdminIcon = PORTAL_ICONS.admin;

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-5 py-10">
      <main className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl text-white tracking-tight">SmartEdu</h1>
          <p className="text-white/75 text-sm mt-1 font-mono">Predictive Analytics for Student Retention</p>
          <p className="text-white text-lg mt-6">Choose how you want to sign in</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <PortalCard portal="student" />
          <PortalCard portal="faculty" />
        </div>

        <Link
          to={loginPathFor("admin")}
          className="mt-5 flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-5 py-3.5 text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-label="Admin sign in"
        >
          <span className="h-9 w-9 rounded-full flex items-center justify-center bg-white/15">
            <AdminIcon size={18} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-medium">{admin.name}</span>
            <span className="block text-sm text-white/75">{admin.description}</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-sm font-medium">
            Sign in <ChevronRight size={16} />
          </span>
          <ChevronRight size={18} className="sm:hidden" />
        </Link>
      </main>
    </div>
  );
}
