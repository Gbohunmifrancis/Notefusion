using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common;

/// <summary>One window the sending quota is counted over: the last <see cref="Length"/>, capped at <see cref="Limit"/>.</summary>
public sealed record EmailWindow(string Name, TimeSpan Length, int Limit);

/// <summary>
/// What one window has sent (every kind, from the <c>email_sends</c> rows) against its limit, and the count at
/// which optional mail stops. Also the System Health card's shape.
/// </summary>
public sealed record EmailWindowUsage(string Window, int Sent, int Limit, int OptionalCeiling);

/// <summary>
/// The sending quota's rules, kept in one place so the sender, the batches and the tests read the same numbers.
/// The provider caps mail per day and per month (Resend's free plan: 100 and 3,000), and the essential mail an
/// account cannot work without (a verification code, a reset link, a receipt) must never be the email that finds
/// the cap used up. So the optional mail (welcome, waitlist confirmation, checkout reminder, transcription tips,
/// outreach) goes only while every capped window is under <see cref="EmailQuotaSettings.OptionalShare"/> of its
/// limit, counting mail of every kind; past that only essential mail is sent, and it always is.
/// </summary>
/// <remarks>
/// <para>
/// The windows are rolling: the last 24 hours, 7 days and 31 days. Resend's day is the UTC calendar day, and a
/// rolling 24 hours always counts at least as much, so it never lets through more than Resend allows. Resend does
/// not say when its month starts (calendar month or billing date); 31 rolling days hold under either.
/// </para>
/// <para>
/// A held message is not lost where something can try it again: the batches ask <see cref="IEmailQuota"/> before
/// claiming, so a held tip, reminder or outreach note stays due for a later run. An inline optional email (the
/// welcome, the waitlist confirmation) is simply skipped: a welcome a day late says nothing.
/// </para>
/// <para>
/// Resend also counts mail it receives for us, which this count cannot see; the essential share's headroom covers it.
/// </para>
/// </remarks>
public static class EmailBudget
{
    public static readonly TimeSpan Day = TimeSpan.FromHours(24);
    public static readonly TimeSpan Week = TimeSpan.FromDays(7);
    public static readonly TimeSpan Month = TimeSpan.FromDays(31);

    public const string HeldCode = "EMAIL_QUOTA_HELD";

    /// <summary>What an optional send held back by the quota reports (outreach keeps it for a later run).</summary>
    public static readonly Error Held = Error.Failure(
        HeldCode, "Held back: optional email has used its share of the sending quota for now.");

    /// <summary>For callers built without a quota (tests, tools): nothing is ever held, nothing recorded.</summary>
    public static readonly IEmailQuota Unlimited = new NoQuota();

    public static bool IsHeld(Error error) => error.Code == HeldCode;

    /// <summary>The mail that can wait: everything but what an account needs to sign in, pay, or stay safe.</summary>
    public static bool IsOptional(EmailKind kind) => kind is
        EmailKind.Welcome
        or EmailKind.WaitlistConfirmation
        or EmailKind.CheckoutReminder
        or EmailKind.TranscriptionTips
        or EmailKind.Outreach;

    /// <summary>The windows that have a limit, shortest first.</summary>
    public static IReadOnlyList<EmailWindow> Windows(EmailQuotaSettings settings)
    {
        var windows = new List<EmailWindow>(3);
        if (settings.DailyLimit is int day and > 0)
            windows.Add(new EmailWindow("day", Day, day));
        if (settings.WeeklyLimit is int week and > 0)
            windows.Add(new EmailWindow("week", Week, week));
        if (settings.MonthlyLimit is int month and > 0)
            windows.Add(new EmailWindow("month", Month, month));
        return windows;
    }

    /// <summary>
    /// The count (all kinds) at which a window stops taking optional mail: the share of its limit, rounded down.
    /// In decimal, so 0.29 of 100 is 29 and not the 28 that 28.999999999999996 would floor to.
    /// </summary>
    public static int OptionalCeiling(int limit, double share)
        => (int)Math.Floor(limit * (decimal)Math.Clamp(share, 0, 1));

    /// <summary>Whether a window that has sent <paramref name="sent"/> may still send an optional email.</summary>
    public static bool AllowsOptional(int sent, int limit, double share) => sent < OptionalCeiling(limit, share);

    private sealed class NoQuota : IEmailQuota
    {
        public Task<bool> AllowsOptionalAsync(EmailKind kind, CancellationToken ct) => Task.FromResult(true);

        public Task RecordSentAsync(EmailKind kind) => Task.CompletedTask;

        public Task<IReadOnlyList<EmailWindowUsage>> ReadUsageAsync(CancellationToken ct)
            => Task.FromResult<IReadOnlyList<EmailWindowUsage>>([]);
    }
}
