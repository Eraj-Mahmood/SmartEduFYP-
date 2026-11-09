import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import { ToastProvider } from "./components/ui/Toast";

// The sign-in pages load with the app; every portal page is its own chunk, fetched on first visit
// (route-level code splitting keeps the first download small; recharts only loads with a chart page).
import Login from "./pages/Login";
import PortalChooser from "./pages/PortalChooser";
const ChangePassword = lazy(() => import("./pages/ChangePassword"));

const StudentDashboard = lazy(() => import("./pages/student/StudentDashboard"));
const StudentResults = lazy(() => import("./pages/student/StudentResults"));
const StudentAttendance = lazy(() => import("./pages/student/StudentAttendance"));

const FacultyDashboard = lazy(() => import("./pages/faculty/FacultyDashboard"));
const ClassRoster = lazy(() => import("./pages/faculty/ClassRoster"));
const MarkAttendance = lazy(() => import("./pages/faculty/MarkAttendance"));
const MyCounselees = lazy(() => import("./pages/faculty/MyCounselees"));
const CounsellingSessions = lazy(() => import("./pages/faculty/CounsellingSessions"));
const StudentCounselling = lazy(() => import("./pages/student/StudentCounselling"));

const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const ManageUsers = lazy(() => import("./pages/admin/ManageUsers"));
const Assignments = lazy(() => import("./pages/admin/Assignments"));
const Interventions = lazy(() => import("./pages/admin/Interventions"));
const Tutorials = lazy(() => import("./pages/admin/Tutorials"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const ModelPage = lazy(() => import("./pages/admin/ModelPage"));
const LiveCohort = lazy(() => import("./pages/admin/LiveCohort"));
const Counselling = lazy(() => import("./pages/admin/Counselling"));
const AcademicStanding = lazy(() => import("./pages/admin/AcademicStanding"));
const WarningLetterPrint = lazy(() => import("./pages/admin/WarningLetterPrint"));

function PageLoading() {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center" role="status" aria-live="polite">
      <span className="h-8 w-8 rounded-full border-2 border-brand/20 border-t-brand animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ToastProvider>
        <Suspense fallback={<PageLoading />}>
        <Routes>
          {/* "/" chooses a portal; each portal has its own sign-in page */}
          <Route path="/" element={<PortalChooser />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/login/student" element={<Login portal="student" />} />
          <Route path="/login/faculty" element={<Login portal="faculty" />} />
          <Route path="/login/admin" element={<Login portal="admin" />} />
          <Route path="/change-password" element={<ChangePassword />} />

          {/* STUDENT PORTAL - read-only */}
          <Route path="/student" element={<ProtectedRoute allowedRole="student"><StudentDashboard /></ProtectedRoute>} />
          <Route path="/student/results" element={<ProtectedRoute allowedRole="student"><StudentResults /></ProtectedRoute>} />
          <Route path="/student/attendance" element={<ProtectedRoute allowedRole="student"><StudentAttendance /></ProtectedRoute>} />
          <Route path="/student/counselling" element={<ProtectedRoute allowedRole="student"><StudentCounselling /></ProtectedRoute>} />

          {/* FACULTY PORTAL - read-write on own classes only */}
          <Route path="/faculty" element={<ProtectedRoute allowedRole="faculty"><FacultyDashboard /></ProtectedRoute>} />
          <Route path="/faculty/class/:facultyCourseId/roster" element={<ProtectedRoute allowedRole="faculty"><ClassRoster /></ProtectedRoute>} />
          <Route path="/faculty/class/:facultyCourseId/attendance" element={<ProtectedRoute allowedRole="faculty"><MarkAttendance /></ProtectedRoute>} />
          <Route path="/faculty/counselees" element={<ProtectedRoute allowedRole="faculty"><MyCounselees /></ProtectedRoute>} />
          <Route path="/faculty/counselling" element={<ProtectedRoute allowedRole="faculty"><CounsellingSessions /></ProtectedRoute>} />

          {/* ADMIN PORTAL - full authority except results/attendance edits */}
          <Route path="/admin" element={<ProtectedRoute allowedRole="admin"><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute allowedRole="admin"><ManageUsers /></ProtectedRoute>} />
          <Route path="/admin/assignments" element={<ProtectedRoute allowedRole="admin"><Assignments /></ProtectedRoute>} />
          <Route path="/admin/interventions" element={<ProtectedRoute allowedRole="admin"><Interventions /></ProtectedRoute>} />
          <Route path="/admin/counselling" element={<ProtectedRoute allowedRole="admin"><Counselling /></ProtectedRoute>} />
          <Route path="/admin/academic-standing" element={<ProtectedRoute allowedRole="admin"><AcademicStanding /></ProtectedRoute>} />
          <Route path="/admin/warning-letters/:id/print" element={<ProtectedRoute allowedRole="admin"><WarningLetterPrint /></ProtectedRoute>} />
          <Route path="/admin/tutorials" element={<ProtectedRoute allowedRole="admin"><Tutorials /></ProtectedRoute>} />
          <Route path="/admin/audit-log" element={<ProtectedRoute allowedRole="admin"><AuditLog /></ProtectedRoute>} />
          <Route path="/admin/model" element={<ProtectedRoute allowedRole="admin"><ModelPage /></ProtectedRoute>} />
          <Route path="/admin/live-cohort" element={<ProtectedRoute allowedRole="admin"><LiveCohort /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
