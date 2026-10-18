using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities.Billing;

/// <summary>
/// One Google Play purchase token and the account it belongs to: a Pro or choir subscription (one token for its
/// whole life, renewals included) or a one-song purchase. Google's state for the token is the truth; this row is
/// what we last read of it, kept so a notification about the token finds its account, the app can say "renews" or
/// "payment problem", and a token can never be claimed by a second account (<see cref="PurchaseToken"/> is unique).
/// </summary>
public class GooglePlayPurchase : BaseEntity
{
    public const int TokenMaxLength = 512;
    public const int ProductIdMaxLength = 100;
    public const int StateMaxLength = 60;
    public const int OrderIdMaxLength = 100;

    private GooglePlayPurchase() { } // EF Core

    public Guid UserId { get; private set; }
    public string PurchaseToken { get; private set; } = string.Empty;

    /// <summary>Google Play's product id: <c>pro</c>, <c>choir</c> or <c>one_song</c>.</summary>
    public string ProductId { get; private set; } = string.Empty;

    /// <summary>The subscription's base plan (<c>monthly</c> or <c>yearly</c>); null for a one-time product.</summary>
    public string? BasePlanId { get; private set; }

    public bool IsSubscription { get; private set; }

    /// <summary>
    /// Google's state, as it names it: <c>SUBSCRIPTION_STATE_ACTIVE</c>, <c>…_IN_GRACE_PERIOD</c>, <c>…_ON_HOLD</c>
    /// and so on for a subscription; <c>PURCHASED</c>, <c>PENDING</c> or <c>CANCELED</c> for a one-time product.
    /// </summary>
    public string State { get; private set; } = string.Empty;

    public bool AutoRenewing { get; private set; }

    /// <summary>When the access Google sold for this token ends; null for a one-time product.</summary>
    public DateTime? ExpiryUtc { get; private set; }

    /// <summary>The last order Google charged on this token (each renewal is an order).</summary>
    public string? LatestOrderId { get; private set; }

    public bool Acknowledged { get; private set; }

    /// <summary>A one-song purchase consumed at Google, so it can be bought again.</summary>
    public bool Consumed { get; private set; }

    /// <summary>
    /// The token that took this one's place: an upgrade, a downgrade or a resubscription before expiry ends this
    /// token and starts a new one that names it. A replaced token grants nothing.
    /// </summary>
    public string? ReplacedByToken { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    public static GooglePlayPurchase Link(
        Guid userId, string purchaseToken, string productId, bool isSubscription, DateTime utcNow) => new()
    {
        Id = Guid.NewGuid(),
        UserId = Guard.AgainstEmpty(userId),
        PurchaseToken = Guard.NotNullOrWhiteSpace(purchaseToken),
        ProductId = Guard.NotNullOrWhiteSpace(productId),
        IsSubscription = isSubscription,
        CreatedAtUtc = utcNow,
        UpdatedAtUtc = utcNow
    };

    /// <summary>What Google reports for the token now.</summary>
    public void Record(
        string state, string? basePlanId, bool autoRenewing, DateTime? expiryUtc, string? latestOrderId, bool acknowledged,
        DateTime utcNow)
    {
        State = Guard.NotNullOrWhiteSpace(state);
        BasePlanId = basePlanId ?? BasePlanId;
        AutoRenewing = autoRenewing;
        ExpiryUtc = expiryUtc;
        LatestOrderId = latestOrderId ?? LatestOrderId;
        Acknowledged = Acknowledged || acknowledged;
        UpdatedAtUtc = utcNow;
    }

    public void MarkAcknowledged(DateTime utcNow)
    {
        Acknowledged = true;
        UpdatedAtUtc = utcNow;
    }

    public void MarkConsumed(DateTime utcNow)
    {
        Consumed = true;
        UpdatedAtUtc = utcNow;
    }

    public void MarkReplacedBy(string purchaseToken, DateTime utcNow)
    {
        ReplacedByToken = Guard.NotNullOrWhiteSpace(purchaseToken);
        AutoRenewing = false;
        UpdatedAtUtc = utcNow;
    }
}
