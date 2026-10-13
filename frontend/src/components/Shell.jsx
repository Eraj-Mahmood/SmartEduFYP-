import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import client from "../api/client";

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const boxRef = useRef(null);

  function load() {
    client.get("/notifications/mine").then((res) => {
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unreadCount);
    });
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

  async function openAndMarkRead(n) {
    if (!n.read_at) {
      await client.put(`/notifications/${n.notification_id}/read`);
      load();
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
        className="relative p-2 rounded hover:bg-white/10 transition text-white/80"
        aria-label="Notifications"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-danger text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white text-ink rounded-lg shadow-xl border border-black/10 z-20 max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
            <span className="font-display text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-ink/40 px-4 py-6 text-center">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.notification_id}
                onClick={() => openAndMarkRead(n)}
                className={`block w-full text-left px-4 py-3 border-b border-black/5 hover:bg-paper transition ${!n.read_at ? "bg-brand/5" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {!n.read_at && <span className="h-1.5 w-1.5 rounded-full bg-brand shrink-0" />}
                  <span className="text-sm font-medium">{n.subject}</span>
                </div>
                <p className="text-xs text-ink/60 mt-1 line-clamp-2">{n.message}</p>
                <p className="text-[10px] text-ink/30 mt-1">{new Date(n.sent_at).toLocaleString()}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function PortalShell({ title, links, children }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-ink text-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl tracking-tight">SmartEdu</span>
            <span className="text-white/50 text-sm font-mono uppercase tracking-wider">{title}</span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="text-white/80 hover:text-white transition">
                {l.label}
              </a>
            ))}
            <NotificationBell />
            <button
              onClick={handleLogout}
              className="ml-2 px-3 py-1.5 rounded border border-white/20 hover:bg-white/10 transition text-white/80"
            >
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

export function RiskBadge({ label }) {
  const map = {
    Safe: "badge-safe",
    "At-Risk": "badge-risk",
    "Dropout-Likely": "badge-danger",
  };
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${map[label] || "badge-risk"}`}>
      {label || "Unknown"}
    </span>
  );
}

export function Card({ title, children, className = "" }) {
  return (
    <div className={`bg-white rounded-lg border border-black/5 shadow-sm p-5 ${className}`}>
      {title && <h3 className="font-display text-lg mb-3 text-ink">{title}</h3>}
      {children}
    </div>
  );
}
