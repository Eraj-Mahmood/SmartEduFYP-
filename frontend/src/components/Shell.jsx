import { useAuth } from "../context/AuthContext";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { Bell, Menu, Close, Logout, Lock, UserCheck, ChevronDown } from "./ui/icons";
import RiskChip from "./ui/RiskChip";
import UiCard from "./ui/Card";

// Navigation per role (the `links` prop pages used to pass is no longer needed).
const NAV = {
  student: [
    { to: "/student", label: "Overview", end: true },
    { to: "/student/results", label: "Results" },
    { to: "/student/attendance", label: "Attendance" },
  ],
  faculty: [
    { to: "/faculty", label: "My classes", end: true, also: ["/faculty/class/"] }, // class roster/attendance pages
    { to: "/faculty/counselees", label: "My counselees" },
  ],
  admin: [
    { to: "/admin", label: "Overview", end: true },
    { to: "/admin/interventions", label: "Interventions" },
    { to: "/admin/tutorials", label: "Tutorials" },
    { to: "/admin/users", label: "Users" },
    { to: "/admin/assignments", label: "Assignments" },
    { to: "/admin/audit-log", label: "Audit log" },
  ],
};

const ROLE_TITLE = { student: "Student", faculty: "Faculty", admin: "Admin" };

function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const boxRef = useRef(null);

  function load() {
    client
      .get("/notifications/mine")
      .then((res) => {
        setNotifications(res.data.notifications);
        setUnreadCount(res.data.unreadCount);
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // poll every 30s for new alerts
    return () => clearInterval(interval);
  }, []);

  // close the dropdown when clicking outside it
  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // mark it read, then open the screen it is about (e.g. the counselee, or "What to do next")
  async function openAndMarkRead(n) {
    if (!n.read_at) {
      await client.put(`/notifications/${n.notification_id}/read`).catch(() => {});
      load();
    }
    if (n.link && n.link.startsWith("/")) {
      setOpen(false);
      navigate(n.link);
    }
  }

  async function markAllRead() {
    await client.put("/notifications/read-all");
    load();
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-white/10 transition text-white/80 hover:text-white"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-danger text-white text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-1.5rem))] bg-surface text-ink rounded-xl shadow-pop border border-line z-30 max-h-96 overflow-y-auto animate-fade-up">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="font-display text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-muted px-4 py-6 text-center">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.notification_id}
                onClick={() => openAndMarkRead(n)}
                className={`block w-full text-left px-4 py-3 border-b border-line/70 hover:bg-paper transition ${!n.read_at ? "bg-brand-50" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-brand shrink-0" />}
                  <span className="text-sm font-medium">{n.subject}</span>
                </div>
                <p className="text-xs text-muted mt-1 line-clamp-2">{n.message}</p>
                <p className="text-[11px] text-muted/80 mt-1 flex items-center justify-between gap-2">
                  {new Date(n.sent_at).toLocaleString()}
                  {n.link && <span className="text-brand font-medium">Open →</span>}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Profile menu (desktop): the signed-in email, Change password, Log out. */
function AccountMenu({ onLogout }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const email = (() => {
    try {
      return JSON.parse(atob(localStorage.getItem("smartedu_token").split(".")[1])).email;
    } catch {
      return "";
    }
  })();

  useEffect(() => {
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const item = "w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-paper";
  return (
    <div className="relative hidden md:block ml-1" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 transition text-sm text-white/80"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <UserCheck size={15} /> Account <ChevronDown size={14} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-60 bg-surface rounded-xl shadow-pop border border-line z-30 overflow-hidden animate-fade-up">
          {email && <p className="px-4 py-2.5 text-xs text-muted border-b border-line truncate">{email}</p>}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              navigate("/change-password");
            }}
          >
            <Lock size={15} /> Change password
          </button>
          <button type="button" role="menuitem" className={`${item} border-t border-line`} onClick={onLogout}>
            <Logout size={15} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

const linkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded-lg text-sm transition ${
    isActive ? "bg-white/15 text-white font-medium" : "text-white/70 hover:text-white hover:bg-white/10"
  }`;

const mobileLinkClass = ({ isActive }) =>
  `block px-3 py-2.5 rounded-lg text-[15px] ${isActive ? "bg-white/15 text-white font-medium" : "text-white/80 hover:bg-white/10"}`;

export function PortalShell({ title, children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = localStorage.getItem("smartedu_role");
  const nav = NAV[role] || [];

  useEffect(() => setMenuOpen(false), [location.pathname]);
  // a link also counts as active on the pages listed in its `also` prefixes
  const inSection = (l) => Boolean(l.also?.some((p) => location.pathname.startsWith(p)));

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-lg">
        Skip to content
      </a>
      <header className="bg-ink text-white sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="font-display text-xl tracking-tight">SmartEdu</span>
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/60 border border-white/15 rounded px-1.5 py-0.5">
              {ROLE_TITLE[role] || title}
            </span>
          </div>

          <nav aria-label="Main" className="hidden md:flex items-center gap-1">
            {nav.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => linkClass({ isActive: isActive || inSection(l) })}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <NotificationBell />
            <AccountMenu onLogout={handleLogout} />
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="md:hidden p-2 rounded-lg hover:bg-white/10 text-white/90"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
            >
              {menuOpen ? <Close size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav id="mobile-nav" aria-label="Main" className="md:hidden border-t border-white/10 px-4 py-3 space-y-1 animate-fade-up">
            {nav.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => mobileLinkClass({ isActive: isActive || inSection(l) })}>
                {l.label}
              </NavLink>
            ))}
            <NavLink to="/change-password" className={mobileLinkClass}>
              <span className="inline-flex items-center gap-2">
                <Lock size={16} /> Change password
              </span>
            </NavLink>
            <button onClick={handleLogout} className="w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-lg text-[15px] text-white/80 hover:bg-white/10">
              <Logout size={16} /> Log out
            </button>
          </nav>
        )}
      </header>
      <main id="main" className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}

/** Kept for older screens; new code uses RiskChip from components/ui. */
export function RiskBadge({ label }) {
  return <RiskChip label={label} size="sm" />;
}

/** Kept for older screens; same as ui/Card. */
export function Card(props) {
  return <UiCard {...props} />;
}
