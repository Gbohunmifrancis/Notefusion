/**
 * The reporting offset, remembered between pages.
 *
 * `GET /overview` echoes the offset it bucketed days in; `GET /users` does not, because an
 * offset is a property of the deployment rather than of a page of rows. Rather than widen
 * that response or spend an extra request, the overview's answer is cached here and the
 * users table formats its timestamps with it.
 *
 * The seed below is only a seed: it matches `AnalyticsRange.ReportingOffset` today, and the
 * first overview response replaces it with whatever the server actually reports. So if the
 * server's offset ever changes, this corrects itself on the next load instead of quietly
 * mislabelling timestamps forever.
 */

const KEY = "nf_admin_reporting_offset";

/** West Africa Time. Superseded by the server's own value as soon as one arrives. */
const SEED_MINUTES = 60;

export function rememberReportingOffset(minutes: number) {
  localStorage.setItem(KEY, String(minutes));
}

export function getReportingOffset(): number {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return SEED_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : SEED_MINUTES;
}
