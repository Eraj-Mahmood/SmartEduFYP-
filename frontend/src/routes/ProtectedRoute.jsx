import { Navigate } from "react-router-dom";
import { loginPathFor } from "../lib/portals";

// Frontend-side gate for UX (instant redirect, no flash of wrong portal).
// The REAL enforcement is server-side via authorize() middleware on every
// API route - this component alone is not a security boundary.
export default function ProtectedRoute({ allowedRole, children }) {
  const token = localStorage.getItem("smartedu_token");
  const role = localStorage.getItem("smartedu_role");

  // not signed in: the sign-in page of the portal this URL belongs to (/student/... -> /login/student)
  if (!token) return <Navigate to={loginPathFor(allowedRole)} replace />;
  // nothing else until a temporary password has been changed
  if (localStorage.getItem("smartedu_must_reset") === "1") return <Navigate to="/change-password" replace />;
  if (role !== allowedRole) return <Navigate to={`/${role}`} replace />;

  return children;
}
