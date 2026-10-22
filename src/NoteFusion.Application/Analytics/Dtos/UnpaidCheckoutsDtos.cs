using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Analytics.Dtos;

/*
 * The console's Unpaid checkouts page (GET /api/admin/analytics/unpaid-checkouts): the person behind each checkout that
 * was opened and not paid, the Growth page's "Why checkouts end unpaid" one row at a time. Customers only
 * (AnalyticsScope). Mirrored in web-admin/src/api/types.ts.
 */

/// <summary>One checkout opened and not paid.</summary>
/// <param name="Name">The account's name; null when the account has been deleted (its payment record stays).</param>
/// <param name="Provider">"bachs", "paystack", "flutterwave" or "googleplay".</param>
/// <param name="Status">Pending (still open, or never paid), Processing (money on its way) or Failed (closed).</param>
/// <param name="Attempt">What the provider's page saw, read whenever the API verified it; null if never read.</param>
/// <param name="CameBack">The app or website reported coming back from the page without paying.</param>
/// <param name="SecondsOpen">How long the page was open, by the client's clock, when it came back.</param>
/// <param name="Reason">The answer to "What stopped you?"; null when none was given.</param>
/// <param name="Note">The words under "Something else".</param>
/// <param name="PaidLaterAtUtc">When the account next completed a payment (any plan), at or after this checkout.</param>
public sealed record UnpaidCheckoutDto(
    Guid PaymentId,
    Guid UserId,
    string? Name,
    string? Email,
    string Provider,
    string? PlanName,
    long AmountMinor,
    string Currency,
    DateTime OpenedAtUtc,
    PaymentStatus Status,
    CheckoutAttempt? Attempt,
    CheckoutClient Client,
    bool CameBack,
    int? SecondsOpen,
    CheckoutExitReason? Reason,
    string? Note,
    DateTime? AnsweredAtUtc,
    DateTime? PaidLaterAtUtc);

/// <param name="QuickSeconds">Open for less than this, with nothing tried, is closed before the ways to pay had shown.</param>
/// <param name="Total">Unpaid checkouts in the window; at most <c>GetUnpaidCheckoutsQueryHandler.RowCount</c> are listed.</param>
public sealed record UnpaidCheckoutsDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int ReportingOffsetMinutes,
    int QuickSeconds,
    int Total,
    IReadOnlyList<UnpaidCheckoutDto> Rows);
