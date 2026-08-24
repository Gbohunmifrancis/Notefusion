using NoteFusion.Application.Common.Settings;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// The one definition of "stuck", shared by every admin query that reports on payments.
/// </summary>
/// <remarks>
/// The background sweep applies the same rule to decide what to reconcile. Both read
/// <see cref="BillingSettings.ReconciliationGraceMinutes"/>, so the table that flags a row and the worker
/// that picks it up can never be looking at different thresholds — which is the bug this exists to
/// prevent, because it would show as the console pointing at rows nothing was going to touch.
/// </remarks>
internal static class PaymentOps
{
    /// <summary>
    /// A payment still in <c>Processing</c> and last touched before this instant is overdue.
    /// </summary>
    internal static DateTime StuckCutoff(DateTime utcNow, BillingSettings settings)
        => utcNow - TimeSpan.FromMinutes(Math.Max(1, settings.ReconciliationGraceMinutes));
}
