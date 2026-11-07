import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import { ToastProvider } from "./components/ui/Toast";

import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";

import StudentDashboard from "./pages/student/StudentDashboard";
import StudentResults from "./pages/student/StudentResults";
import StudentAttendance from "./pages/student/StudentAttendance";

import FacultyDashboard from "./pages/faculty/FacultyDashboard";
import ClassRoster from "./pages/faculty/ClassRoster";
import MarkAttendance from "./pages/faculty/MarkAttendance";
import MyCounselees from "./pages/faculty/MyCounselees";

import AdminDashboard from "./pages/admin/AdminDashboard";
import ManageUsers from "./pages/admin/ManageUsers";
import Assignments from "./pages/admin/Assignments";
import Interventions from "./pages/admin/Interventions";
import Tutorials from "./pages/admin/Tutorials";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<ChangePassword />} />

          {/* STUDENT PORTAL - read-only */}
          <Route path="/student" element={<ProtectedRoute allowedRole="student"><StudentDashboard /></ProtectedRoute>} />
          <Route path="/student/results" element={<ProtectedRoute allowedRole="student"><StudentResults /></ProtectedRoute>} />
          <Route path="/student/attendance" element={<ProtectedRoute allowedRole="student"><StudentAttendance /></ProtectedRoute>} />

          {/* FACULTY PORTAL - read-write on own classes only */}
          <Route path="/faculty" element={<ProtectedRoute allowedRole="faculty"><FacultyDashboard /></ProtectedRoute>} />
          <Route path="/faculty/class/:facultyCourseId/roster" element={<ProtectedRoute allowedRole="faculty"><ClassRoster /></ProtectedRoute>} />
          <Route path="/faculty/class/:facultyCourseId/attendance" element={<ProtectedRoute allowedRole="faculty"><MarkAttendance /></ProtectedRoute>} />
          <Route path="/faculty/counselees" element={<ProtectedRoute allowedRole="faculty"><MyCounselees /></ProtectedRoute>} />

          {/* ADMIN PORTAL - full authority except results/attendance edits */}
          <Route path="/admin" element={<ProtectedRoute allowedRole="admin"><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute allowedRole="admin"><ManageUsers /></ProtectedRoute>} />
          <Route path="/admin/assignments" element={<ProtectedRoute allowedRole="admin"><Assignments /></ProtectedRoute>} />
          <Route path="/admin/interventions" element={<ProtectedRoute allowedRole="admin"><Interventions /></ProtectedRoute>} />
          <Route path="/admin/tutorials" element={<ProtectedRoute allowedRole="admin"><Tutorials /></ProtectedRoute>} />

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
