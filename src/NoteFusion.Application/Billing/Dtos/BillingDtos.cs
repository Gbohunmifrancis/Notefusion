using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Billing.Dtos;

/// <summary>A plan as shown on the mobile paywall. Amount is in the currency's minor units.</summary>
public sealed record PlanDto(Guid Id, string Code, string Name, long AmountMinor, string Currency, BillingInterval Interval);

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
/// Free transcriptions still available, floored at zero. Meaningless while <paramref name="IsActive"/>
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
    bool IsLifetime);

/// <summary>A balance derived by summing the immutable ledger — never read from a stored column.</summary>
public sealed record LedgerBalanceDto(long BalanceMinor, string Currency);
