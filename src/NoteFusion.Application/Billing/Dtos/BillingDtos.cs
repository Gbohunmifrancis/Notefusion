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
public sealed record PublicPricingDto(string? CountryCode, IReadOnlyList<PlanDto> Plans);

/// <summary>
/// A hosted-checkout session. The app opens <see cref="CheckoutUrl"/> in an external browser
/// (Spotify-style) and never collects card details itself; the result arrives by webhook.
/// </summary>
public sealed record CheckoutSessionDto(string Reference, string CheckoutUrl, PaymentProvider Provider);

/// <summary>The caller's subscription state, enough for the app to gate Pro features.</summary>
/// <param name="TrialGenerationsRemaining">
/// Free-tier transcriptions still available, bought ones included, floored at zero; measured against
/// <c>TrialGenerationsTotal</c>, which is the free three plus every transcription bought. Meaningless while <paramref name="IsActive"/>
/// is true — Pro is unlimited — and reported anyway so the app has one shape to read.
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
    string? ChoirRole = null);

/// <summary>A balance derived by summing the immutable ledger — never read from a stored column.</summary>
public sealed record LedgerBalanceDto(long BalanceMinor, string Currency);
