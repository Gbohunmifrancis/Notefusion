import type { AuditAction } from "@/api/types";
import type { BadgeTone } from "@/components/Badge";

/**
 * Display metadata for the audit actions, in one place because two pages render the same pills and
 * the audit-log filter has to offer exactly the set the server accepts.
 *
 * The keys are the C# enum member names as they arrive on the wire, and they are also what the
 * filter sends back up — MVC binds query-string enums case-insensitively, so the same literal works
 * in both directions and there is no second spelling to keep in step.
 *
 * Tones are read as "did this take something away": revoking, ending and suspending are losses to
 * the account and are the rows an operator scans a page for.
 */
export const AUDIT_ACTIONS: readonly { value: AuditAction; label: string; tone: BadgeTone }[] = [
  { value: "GiftPro", label: "Gift Pro", tone: "premium" },
  { value: "RevokePro", label: "Revoke Pro", tone: "danger" },
  { value: "ExtendSubscription", label: "Extend subscription", tone: "blue" },
  { value: "EndSubscription", label: "End subscription", tone: "danger" },
  { value: "SuspendUser", label: "Suspend", tone: "danger" },
  { value: "ReactivateUser", label: "Reactivate", tone: "success" },
  { value: "CreateUser", label: "Create account", tone: "blue" },
  { value: "SendPasswordReset", label: "Send reset link", tone: "neutral" },
  { value: "ChangeRole", label: "Change role", tone: "warning" },
  // Takes nothing away — it asks a gateway what happened and writes down the answer — but it is the
  // one row here that can hand out access, so it reads as a change rather than as neutral.
  { value: "ReconcilePayment", label: "Reconcile payment", tone: "blue" },
];

const BY_VALUE = new Map(AUDIT_ACTIONS.map((entry) => [entry.value, entry]));

/**
 * The action's label and tone. Falls back to the raw wire value rather than to "Unknown", so a
 * member added to the C# enum before this table is updated still reads as itself on the page.
 */
export function auditMeta(action: string): { label: string; tone: BadgeTone } {
  return BY_VALUE.get(action as AuditAction) ?? { label: action, tone: "neutral" };
}
