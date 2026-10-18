using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Analytics.Dtos;

/*
 * The console's Growth page (GET /api/admin/analytics/growth): the figures the founder had no view of — renewals
 * (the membership business's churn), free-to-paid by price set, transcription failures by kind, app versions on
 * phones, and why checkouts end unpaid. Customers only (AnalyticsScope). Mirrored in web-admin/src/api/types.ts.
 */

/// <summary>A membership whose current period ends soon: Pro (paid or a console gift) or a choir, by its director.</summary>
/// <param name="Kind">"pro" or "choir".</param>
public sealed record EndingMembershipDto(Guid UserId, string FullName, string Email, string Kind, string Plan, bool Paid, DateTime EndsAtUtc);

/// <summary>
/// Renewals. Nothing renews by itself: a member buys again to add a period, which stacks after the time left. Paid
/// periods are rebuilt from the ledger's membership charges (Pro and choir plans; gifts and console extensions are
/// not payments and are left out), and each period's end is "due". A due end is renewed when the member paid again
/// before it or within <see cref="GraceDays"/> days after it, lapsed when that time passed with no payment, and still
/// deciding while it has not.
/// </summary>
/// <param name="EndingIn7Days">Memberships (Pro, paid or gifted, and choirs) whose current period ends within 7 days from now.</param>
/// <param name="EndingIn30Days">The same within 30 days.</param>
/// <param name="DueInWindow">Paid periods whose end fell in the window (up to now).</param>
/// <param name="RenewalRate">Renewed over renewed plus lapsed; null while none has been decided.</param>
public sealed record RenewalsDto(
    int GraceDays,
    int EndingIn7Days,
    int EndingIn30Days,
    IReadOnlyList<CategoryCountDto> EndingIn30DaysByKind,
    IReadOnlyList<EndingMembershipDto> EndingSoon,
    int DueInWindow,
    int RenewedEarly,
    int RenewedLate,
    int Lapsed,
    int Deciding,
    double? RenewalRate);

/// <summary>
/// The accounts that signed up in the window, by the price set their country is offered, and how far each got, ever.
/// </summary>
/// <param name="Set">"naira" (Nigeria), "regional" (the regional dollar countries), "standard" (every other known country) or "unknown".</param>
/// <param name="Transcribed">Had a transcription produce a result.</param>
/// <param name="ReachedFreeLimit">Spent every free transcription of some week (the same rule as Insights).</param>
/// <param name="StartedCheckout">Asked for a checkout (a payment row exists, whatever became of it).</param>
/// <param name="Paid">Paid for anything: Pro, a choir or one song (a ledger credit).</param>
/// <param name="MedianDaysToPay">Days from signing up to the first payment, the median of those who paid.</param>
public sealed record PriceSetFunnelDto(
    string Set,
    int SignedUp,
    int Transcribed,
    int ReachedFreeLimit,
    int StartedCheckout,
    int Paid,
    double? PaidRate,
    double? MedianDaysToPay);

/// <summary>Jobs started in the window of one kind, and how they ended.</summary>
/// <param name="Kind">"recording", "song", "link" or "preview".</param>
/// <param name="FailureRate">Failed over finished (succeeded plus failed); null while none has finished.</param>
public sealed record KindHealthDto(string Kind, int Started, int Succeeded, int Failed, int Running, double? FailureRate);

/// <param name="LinkAttempts">Song links asked for in the window (account and preview), from the transcription log.</param>
/// <param name="LinkRefused">Refused before the worker took them: the link could not be used (private, live, too long…).</param>
/// <param name="LinkFailed">Taken, then failed.</param>
/// <param name="LinkProblems">Refusals and failures by the sentence the user was shown, which names the reason (one per refusal code).</param>
public sealed record TranscriptionHealthDto(
    IReadOnlyList<KindHealthDto> ByKind,
    int LinkAttempts,
    int LinkRefused,
    int LinkFailed,
    IReadOnlyList<CategoryCountDto> LinkProblems);

/// <summary>Customers' phones on one native build.</summary>
/// <param name="Build">The native (store) build the phone last registered with; 0 when it registered before builds were reported.</param>
/// <param name="Recent">Of them, phones that registered again in the last 30 days (each sign-in and app start does).</param>
/// <param name="ServerReminders">Of them, phones running the app code that takes reminders from the server (an over-the-air update).</param>
public sealed record AppBuildRowDto(int Build, int Phones, int Recent, int Android, int Ios, int ServerReminders);

/// <param name="LatestBuild">The newest store build (<c>AppRelease__LatestBuild</c>); 0 when not set.</param>
public sealed record AppVersionsDto(
    int LatestBuild,
    int Phones,
    int Recent,
    int OnLatestBuild,
    int ServerReminders,
    IReadOnlyList<AppBuildRowDto> Builds);

/// <summary>How many of one provider's unpaid returns gave each answer to "What stopped you?".</summary>
public sealed record CheckoutExitReasonCountDto(CheckoutExitReason Reason, int Count);

/// <summary>
/// The checkouts opened in the window on one provider (<c>"all"</c>, <c>"bachs"</c> or <c>"paystack"</c>), and why
/// they ended unpaid.
/// </summary>
/// <param name="Opened">Checkouts whose payment page was handed out (a checkout URL), by when they were opened.</param>
/// <param name="CameBackUnpaid">Of them, those whose client reported coming back from the page without paying.</param>
/// <param name="Answered">Of those, the ones that answered "What stopped you?".</param>
/// <param name="Paid">Of the opened, paid and fulfilled.</param>
/// <param name="Confirming">Of the opened, money on its way: verified and not yet fulfilled, or a transfer under way.</param>
/// <param name="Reasons">The answers, every reason in the enum's order, zeros included.</param>
/// <param name="ClosedQuickly">
/// Of those who came back unpaid, what the provider's page saw: no attempt and closed in under
/// <see cref="CheckoutExitsDto.QuickSeconds"/> seconds (before Bachs had shown the ways to pay).
/// </param>
/// <param name="Declined">A failed charge on record.</param>
/// <param name="LeftAfterLooking">No attempt, open <see cref="CheckoutExitsDto.QuickSeconds"/> seconds or more.</param>
/// <param name="TransferStarted">A transfer under way when last read (never asked, since money was moving).</param>
public sealed record CheckoutExitSliceDto(
    string Provider,
    int Opened,
    int CameBackUnpaid,
    int Answered,
    int Paid,
    int Confirming,
    IReadOnlyList<CheckoutExitReasonCountDto> Reasons,
    int ClosedQuickly,
    int Declined,
    int LeftAfterLooking,
    int TransferStarted);

/// <summary>One "Something else" note, newest first: the words, the provider and when. No account, no email.</summary>
public sealed record CheckoutExitNoteDto(DateTime AnsweredAtUtc, string Provider, string Note);

/// <summary>"Why checkouts end unpaid": the window's checkouts by provider, and the latest "Something else" notes.</summary>
/// <param name="QuickSeconds">Under this many seconds open counts as closed before the ways to pay had shown.</param>
public sealed record CheckoutExitsDto(
    int QuickSeconds,
    IReadOnlyList<CheckoutExitSliceDto> Providers,
    IReadOnlyList<CheckoutExitNoteDto> Notes);

public sealed record GrowthDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int ReportingOffsetMinutes,
    RenewalsDto Renewals,
    IReadOnlyList<PriceSetFunnelDto> FreeToPaid,
    TranscriptionHealthDto Transcriptions,
    AppVersionsDto AppVersions,
    CheckoutExitsDto CheckoutExits);
