import { Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { RequireAdmin } from "@/components/RequireAdmin";
import { AuthProvider } from "@/lib/auth";
import { AuditLogPage } from "@/pages/AuditLogPage";
import { HealthPage } from "@/pages/HealthPage";
import { LoginPage } from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { UserDetailPage } from "@/pages/UserDetailPage";
import { UsersPage } from "@/pages/UsersPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* The gate wraps the layout rather than each page, so a route added below inherits
            it instead of shipping unprotected because someone forgot the wrapper. */}
        <Route
          element={
            <RequireAdmin>
              <Layout />
            </RequireAdmin>
          }
        >
          <Route path="/" element={<OverviewPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:id" element={<UserDetailPage />} />
          <Route path="/audit-log" element={<AuditLogPage />} />
          <Route path="/health" element={<HealthPage />} />
        </Route>

        {/* An unknown path goes to the overview, which redirects to /login if not signed in. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
