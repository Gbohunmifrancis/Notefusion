using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Billing.Dtos;

/// <summary>A plan as shown on the mobile paywall. Amount is in the currency's minor units.</summary>
/// <param name="ChoirSeats">Singers a choir plan seats besides the director; null for every other plan.</param>
public sealed record PlanDto(
    Guid Id, string Code, string Name, long AmountMinor, string Currency, BillingInterval Interval, int? ChoirSeats = null);

/// <summary>
/// The region-aware offer for an anonymous marketing-site visitor. A null country means the geo lookup did
/// not produce a trustworthy answer, so <see cref="Plans"/> is empty rather than exposing both regional tiers.
/// </summary>
/// <param name="Single">
/// The region's one-song purchase, for the free card's "or ₦3,000 a song"; null when none is on sale or the
/// country is unknown. Apart from <see cref="Plans"/>, which older pages render as Pro Monthly or Yearly.
/// </param>
/// <param name="Choir">
/// The region's choir plans (a director's, seating <see cref="PlanDto.ChoirSeats"/> singers), cheapest first, for
/// the pricing note; apart from <see cref="Plans"/> for the same reason as <see cref="Single"/>.
/// </param>
public sealed record PublicPricingDto(
    string? CountryCode, IReadOnlyList<PlanDto> Plans, PlanDto? Single = null, IReadOnlyList<PlanDto>? Choir = null);

/// <summary>
/// A hosted-checkout session. The app opens <see cref="CheckoutUrl"/> in an external browser
/// (Spotify-style) and never collects card details itself; the result arrives by webhook.
/// </summary>
public sealed record CheckoutSessionDto(string Reference, string CheckoutUrl, PaymentProvider Provider);

/// <summary>
/// The answer to a client reporting it came back from a checkout unpaid (<c>POST /api/billing/checkouts/{id}/exit</c>).
/// </summary>
/// <param name="Ask">
/// Show "What stopped you?": the first return of this checkout, not paid, no transfer under way, no answer sent.
/// </param>
/// <param name="Currency">The checkout's currency, as charged ("USD", "NGN").</param>
/// <param name="AmountMinor">The checkout's amount in minor units, for "the page turns your $9.99 into naira".</param>
/// <param name="KeptMinutes">How long an open checkout is handed back by "Try again" (<c>Billing__CheckoutReuseMinutes</c>).</param>
public sealed record CheckoutExitDto(bool Ask, string Currency, long AmountMinor, int KeptMinutes);

/// <summary>The caller's subscription state, enough for the app to gate Pro features.</summary>
/// <param name="TrialGenerationsRemaining">
/// Free-tier transcriptions still available, this week's free ones and the bought ones, floored at zero;
/// measured against <c>TrialGenerationsTotal</c>, which is the free three a week plus every transcription
/// bought. Kept with that meaning for apps that predate the weekly fields below. Meaningless while
/// <paramref name="IsActive"/> is true — Pro is unlimited — and reported anyway so the app has one shape to read.
/// </param>
/// <param name="IsLifetime">
/// True when Pro was bought outright. Sent as its own flag rather than left for the client to infer
/// from <paramref name="CurrentPeriodEndUtc"/>: the period end carries a far-future sentinel, and an
/// app that formats it renders "renews 31 December 9999".
/// </param>
public sealed record SubscriptionDto(
    bool IsActive,
    string? PlanCode,
    SubscriptionStatus? Status,
    DateTime? CurrentPeriodEndUtc,
    int TrialGenerationsRemaining,
    int TrialGenerationsTotal,
    bool IsLifetime,
    bool IsGift = false,
    /// <summary>Linked songs left this month on Pro, or free previews left otherwise.</summary>
    int SongCreditsRemaining = 0,
    /// <summary>The allowance the remaining count is measured against (Pro songs a month, or free previews).</summary>
    int SongCreditsTotal = 0,
    /// <summary>The plan's display name ("NoteFusion Pro (Monthly)"); null without a subscription.</summary>
    string? PlanName = null,
    /// <summary>A free account that has not yet used its one four-part harmony. Always false on Pro.</summary>
    bool FreeHarmonyAvailable = false,
    /// <summary>
    /// Bought transcriptions not yet spent (one-song purchases; they never expire). Already counted in
    /// <c>TrialGenerationsRemaining</c>; reported on its own so the app can say "1 bought song left" and so a
    /// free account knows a whole linked song is open to it.
    /// </summary>
    int BoughtTranscriptionsRemaining = 0,
    /// <summary>Transcriptions this account has ever bought. Rises by one when a one-song payment lands.</summary>
    int BoughtTranscriptionsTotal = 0,
    /// <summary>
    /// The choir this account is Pro through (as its director or a singer) while that choir's plan runs; null
    /// otherwise. When the account has no Pro of its own, the plan and period above are the choir's.
    /// </summary>
    string? ChoirName = null,
    /// <summary><c>"director"</c> or <c>"member"</c> alongside <see cref="ChoirName"/>; null without one.</summary>
    string? ChoirRole = null,
    /// <summary>
    /// When the period of the choir this account directs or sings in ends, running or lapsed; null without a
    /// choir. Reported apart from <see cref="CurrentPeriodEndUtc"/> so a client watching a choir payment land
    /// sees it move even for a director who also has Pro of their own.
    /// </summary>
    DateTime? ChoirPeriodEndUtc = null,
    /// <summary>
    /// This week's free hummed or recorded transcriptions not yet spent or held by a running job, floored at
    /// zero; bought ones not included. Already counted in <c>TrialGenerationsRemaining</c>, which older apps read.
    /// </summary>
    int FreeTranscriptionsRemaining = 0,
    /// <summary>Free hummed or recorded transcriptions a week (<c>FreeTier.TrialGenerations</c>).</summary>
    int FreeTranscriptionsPerWeek = 0,
    /// <summary>
    /// When this week's free transcriptions come back: the next Friday 18:00 West Africa Time, in UTC. The apps
    /// show it in the user's own time.
    /// </summary>
    DateTime? FreeResetsAtUtc = null,
    /// <summary>
    /// Who takes the money for this membership: <c>"googlePlay"</c> (Google renews it; it is managed and cancelled in
    /// Google Play), <c>"web"</c> (bought on the website; nothing renews by itself), or null (a gift, a choir singer,
    /// no membership).
    /// </summary>
    string? BilledThrough = null,
    /// <summary>Google Play will charge again when the period ends (false once cancelled in Google Play).</summary>
    bool AutoRenews = false,
    /// <summary>
    /// A Google Play renewal that has not been paid: <c>"grace"</c> (Pro stays on while Google retries the card) or
    /// <c>"hold"</c> (still unpaid, Pro paused until it is). Null otherwise.
    /// </summary>
    string? PaymentIssue = null,
    /// <summary>The Google Play product a Play membership is (<c>pro</c> or <c>choir</c>), for the app's link to it in Google Play.</summary>
    string? StoreProductId = null);

/// <summary>A balance derived by summing the immutable ledger — never read from a stored column.</summary>
public sealed record LedgerBalanceDto(long BalanceMinor, string Currency);
