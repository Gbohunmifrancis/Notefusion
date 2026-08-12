import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/session";

/**
 * Route gate. This hides the dashboard from someone who is not signed in as an admin; it
 * does not protect the data. The API enforces the Admin policy on every request, so
 * editing localStorage to get past this gate buys a 403 from the server, not analytics.
 */
export function RequireAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!isAdmin(user)) {
    // The attempted path rides along so sign-in can return the admin to it.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
