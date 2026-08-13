using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Billing.Dtos;

/// <summary>A plan as shown on the mobile paywall. Amount is in the currency's minor units.</summary>
public sealed record PlanDto(Guid Id, string Code, string Name, long AmountMinor, string Currency, BillingInterval Interval);

/// <summary>
/// A hosted-checkout session. The app opens <see cref="CheckoutUrl"/> in an external browser
/// (Spotify-style) and never collects card details itself; the result arrives by webhook.
/// </summary>
public sealed record CheckoutSessionDto(string Reference, string CheckoutUrl, PaymentProvider Provider);

/// <summary>The caller's subscription state, enough for the app to gate Pro features.</summary>
public sealed record SubscriptionDto(
    bool IsActive,
    string? PlanCode,
    SubscriptionStatus? Status,
    DateTime? CurrentPeriodEndUtc);

/// <summary>A balance derived by summing the immutable ledger — never read from a stored column.</summary>
public sealed record LedgerBalanceDto(long BalanceMinor, string Currency);
