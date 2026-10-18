using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The Google Play Developer API for this app's package: what Google says about a purchase token, the order behind a
/// charge, and the two acknowledgements a purchase needs. Google is the truth for every purchase made in the Android
/// app; the server only reads it, records it and acts on it (<c>GooglePlaySync</c>). Not configured (no service
/// account), every call fails with <c>BILLING_PLAY_NOT_CONFIGURED</c> and nothing is granted.
/// </summary>
public interface IGooglePlayClient
{
    bool IsConfigured { get; }

    /// <summary>The app's package name, which Google's notifications name too.</summary>
    string PackageName { get; }

    /// <summary><c>purchases.subscriptionsv2.get</c>: the subscription a token stands for, now.</summary>
    Task<Result<PlaySubscription>> GetSubscriptionAsync(string purchaseToken, CancellationToken ct);

    /// <summary><c>purchases.products.get</c>: a one-time product purchase.</summary>
    Task<Result<PlayOneTimePurchase>> GetOneTimePurchaseAsync(string productId, string purchaseToken, CancellationToken ct);

    /// <summary><c>orders.get</c>: what an order charged, tax included, and whether it still stands.</summary>
    Task<Result<PlayOrder>> GetOrderAsync(string orderId, CancellationToken ct);

    /// <summary>
    /// <c>purchases.subscriptions.acknowledge</c>. A new subscription Google is not told about within three days is
    /// refunded and revoked by Google.
    /// </summary>
    Task<Result> AcknowledgeSubscriptionAsync(string productId, string purchaseToken, CancellationToken ct);

    /// <summary><c>purchases.products.consume</c>: acknowledges a one-song purchase and lets it be bought again.</summary>
    Task<Result> ConsumeAsync(string productId, string purchaseToken, CancellationToken ct);
}

/// <summary>
/// A subscription as Google reports it (<c>SubscriptionPurchaseV2</c>, its first line item).
/// </summary>
/// <param name="State">Google's <c>subscriptionState</c>, e.g. <c>SUBSCRIPTION_STATE_ACTIVE</c>.</param>
/// <param name="ExpiryUtc">When access ends: the next renewal, the end of a grace period, or a past time on hold.</param>
/// <param name="LatestSuccessfulOrderId">The last order that was actually charged; null before any.</param>
/// <param name="LinkedPurchaseToken">The token this one replaced (an upgrade, downgrade or early resubscribe).</param>
/// <param name="AccountId">The obfuscated account id the app set when buying: our user id.</param>
public sealed record PlaySubscription(
    string State,
    string? ProductId,
    string? BasePlanId,
    DateTime? ExpiryUtc,
    bool AutoRenewing,
    string? LatestSuccessfulOrderId,
    string? LinkedPurchaseToken,
    string? AccountId,
    bool Acknowledged,
    string? RegionCode,
    string Raw);

/// <summary>A one-time product purchase as Google reports it (<c>ProductPurchase</c>).</summary>
/// <param name="State"><c>PURCHASED</c>, <c>CANCELED</c> or <c>PENDING</c> (Google's 0, 1, 2).</param>
public sealed record PlayOneTimePurchase(
    string State,
    string? OrderId,
    string? AccountId,
    bool Acknowledged,
    bool Consumed,
    string? RegionCode,
    string Raw);

/// <summary>An order: what the customer paid in all (tax included), in the currency they paid, and its state.</summary>
/// <param name="State">Google's order state: <c>PROCESSED</c>, <c>PENDING</c>, <c>REFUNDED</c> and so on.</param>
public sealed record PlayOrder(long TotalMinor, string Currency, string State);
