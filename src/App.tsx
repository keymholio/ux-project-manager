import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { useAuth } from "./context/AuthContext";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import ProjectDetail from "./pages/ProjectDetail";
import Projects from "./pages/Projects";
import ResetPassword from "./pages/ResetPassword";
import Settings from "./pages/Settings";
import TaskBoard from "./pages/TaskBoard";
import TaskDetail from "./pages/TaskDetail";
import UserAdmin from "./pages/UserAdmin";

export default function App() {
  const { session, loading, isRecovering } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-500">
        Loading…
      </div>
    );
  }

  // Password recovery takes priority over everything — the user arrived here
  // from an email link and has a short-lived session for the sole purpose of
  // choosing a new password.
  if (isRecovering) {
    return <ResetPassword />;
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/tasks" element={<TaskBoard />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/settings" element={<Settings />} />
        {/* Manager-only. Guard is re-enforced inside the page so a
            non-manager typing the URL gets bounced to the dashboard. */}
        <Route path="/admin/users" element={<UserAdmin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
