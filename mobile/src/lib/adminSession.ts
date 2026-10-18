import { useEffect, useRef } from "react";
import { lockAdmin } from "./adminLockRuntime";

/**
 * Locks Admin and drops what it read whenever the signed-in account changes: a sign-out (null) or another account
 * signing in on this phone. Admin's figures never outlive the session that read them.
 */
export function useAdminSession(userId: string | null): void {
  const last = useRef<string | null>(userId);
  useEffect(() => {
    if (last.current !== userId) lockAdmin();
    last.current = userId;
  }, [userId]);
}
