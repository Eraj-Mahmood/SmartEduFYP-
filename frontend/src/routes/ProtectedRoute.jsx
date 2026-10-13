import { Navigate } from "react-router-dom";

// Frontend-side gate for UX (instant redirect, no flash of wrong portal).
// The REAL enforcement is server-side via authorize() middleware on every
// API route - this component alone is not a security boundary.
export default function ProtectedRoute({ allowedRole, children }) {
  const token = localStorage.getItem("smartedu_token");
  const role = localStorage.getItem("smartedu_role");

  if (!token) return <Navigate to="/login" replace />;
  if (role !== allowedRole) return <Navigate to={`/${role}`} replace />;

  return children;
}
