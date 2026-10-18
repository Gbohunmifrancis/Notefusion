using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Choirs;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.GooglePlay;

/// <summary>What one sync of a purchase token came to.</summary>
public enum PlaySyncOutcome
{
    /// <summary>Google's state is applied: access granted, renewed, kept, or ended as Google says.</summary>
    Applied,

    /// <summary>Google is still waiting for the money (a cash or delayed payment); nothing is granted yet.</summary>
    Pending,

    /// <summary>No account could be found for the token yet; the app's own call will claim it.</summary>
    Unclaimed
}

/// <summary>
/// The one place a Google Play purchase is turned into access, whoever asks: the app straight after buying or on
/// restore, Google's real-time notification, or the acknowledgement sweep. It reads the token's state from Google
/// (never from the client), ties the token to one account, records each order Google charged as a completed payment
/// through <see cref="PaymentFulfillment"/> (ledger, admin alert, receipt), and then makes the membership follow
/// Google: Google renews it, so its period ends when Google's access does, through a grace period, a cancellation,
/// account hold or a refund. Finally it acknowledges a new subscription (consumes a one-song purchase), without
/// which Google refunds it after three days.
/// </summary>
/// <remarks>
/// One token at a time (<see cref="IQuotaGate"/>, key <c>play:{token}</c>), so the app's call and Google's
/// notification arriving together apply it once, and one account's subscriptions at a time (<c>play-user:{id}</c>). Every step is idempotent: an order is recorded once (its order id
/// is the payment's unique reference), and re-reading a token only re-applies what Google says.
/// </remarks>
public sealed class GooglePlaySync
{
    public const string ProProduct = "pro";
    public const string ChoirProduct = "choir";
    public const string SongProduct = "one_song";
    public const string YearlyBasePlan = "yearly";

    public const string StateActive = "SUBSCRIPTION_STATE_ACTIVE";
    public const string StateCanceled = "SUBSCRIPTION_STATE_CANCELED";
    public const string StateGrace = "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
    public const string StateOnHold = "SUBSCRIPTION_STATE_ON_HOLD";
    public const string StatePending = "SUBSCRIPTION_STATE_PENDING";
    public const string StatePendingCanceled = "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";

    public const string OneTimePurchased = "PURCHASED";

    /// <summary>Order states that mean the money did not stay with us; such an order is not recorded as paid.</summary>
    private static readonly string[] UnpaidOrderStates = ["CANCELED", "REFUNDED", "PENDING_REFUND"];

    private readonly IApplicationDbContext _db;
    private readonly IGooglePlayClient _play;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;
    private readonly IQuotaGate _gate;
    private readonly ILogger<GooglePlaySync> _logger;

    public GooglePlaySync(
        IApplicationDbContext db, IGooglePlayClient play, IDateTimeProvider clock, IEmailSender email, IQuotaGate gate,
        ILogger<GooglePlaySync> logger)
    {
        _db = db;
        _play = play;
        _clock = clock;
        _email = email;
        _gate = gate;
        _logger = logger;
    }

    public static bool IsSubscriptionProduct(string? productId) => productId is ProProduct or ChoirProduct;

    /// <summary>Access stands in these states, up to the expiry time (Google extends it through a grace period).</summary>
    public static bool IsEntitledState(string? state) => state is StateActive or StateCanceled or StateGrace;

    /// <summary>
    /// Applies a subscription token. <paramref name="caller"/> is the signed-in account when the app asks, and null
    /// for Google's notification and the sweep, which find the account from the token's own records.
    /// </summary>
    public async Task<Result<PlaySyncOutcome>> SyncSubscriptionAsync(string purchaseToken, Guid? caller, CancellationToken ct)
    {
        if (!_play.IsConfigured)
            return BillingErrors.PlayNotConfigured;

        await using var lease = await _gate.AcquireAsync(Key(purchaseToken), ct);

        var read = await _play.GetSubscriptionAsync(purchaseToken, ct);
        if (read.IsFailure)
            return read.Error;
        var s = read.Value;
        if (!IsSubscriptionProduct(s.ProductId))
            return BillingErrors.PlayPurchaseNotFound;
        var productId = s.ProductId!;

        var now = _clock.UtcNow;
        var link = await _db.GooglePlayPurchases.FirstOrDefaultAsync(p => p.PurchaseToken == purchaseToken, ct);
        var owner = await ResolveOwnerAsync(link, s.AccountId, s.LinkedPurchaseToken, caller, ct);
        if (owner.IsFailure)
            return owner.Error;
        if (owner.Value is not { } userId)
        {
            _logger.LogWarning("Google Play subscription notified before any account claimed it; left for the app.");
            return PlaySyncOutcome.Unclaimed;
        }

        // And one account at a time: two of its tokens (an upgrade beside the old one) move the same membership row.
        await using var accountLease = await _gate.AcquireAsync($"play-user:{userId}", ct);

        var firstSeen = link is null;
        if (link is null)
        {
            link = GooglePlayPurchase.Link(userId, purchaseToken, productId, isSubscription: true, now);
            _db.GooglePlayPurchases.Add(link);
        }

        // An upgrade, downgrade or early resubscribe ends the old token: from now on only this one grants anything.
        if (s.LinkedPurchaseToken is { } replaced && replaced != purchaseToken)
        {
            var old = await _db.GooglePlayPurchases.FirstOrDefaultAsync(p => p.PurchaseToken == replaced, ct);
            if (old is not null && old.ReplacedByToken is null)
                old.MarkReplacedBy(purchaseToken, now);
        }

        link.Record(s.State, s.BasePlanId, s.AutoRenewing, s.ExpiryUtc, s.LatestSuccessfulOrderId, s.Acknowledged, now);

        if (s.State is StatePending or StatePendingCanceled)
        {
            await _db.SaveChangesAsync(ct);
            return PlaySyncOutcome.Pending;
        }

        var fulfillments = new List<Fulfillment>();
        if (link.ReplacedByToken is null && s.LatestSuccessfulOrderId is { } orderId)
        {
            var fulfillment = await RecordOrderAsync(
                userId, productId, s.BasePlanId, s.RegionCode, orderId, IsEntitledState(s.State), s.ExpiryUtc, s.Raw, now, ct);
            if (fulfillment is not null)
                fulfillments.Add(fulfillment);
        }

        await FollowAsync(userId, productId, now, ct);
        await PaymentFulfillment.SaveAsync(_db, fulfillments, ct);

        // Google sends its own receipt for every charge; ours goes for the purchase itself, never each renewal.
        if (firstSeen)
            await SendReceiptsAsync(fulfillments, ct);

        if (!link.Acknowledged && IsEntitledState(s.State))
        {
            var ack = await _play.AcknowledgeSubscriptionAsync(productId, purchaseToken, ct);
            if (ack.IsSuccess)
            {
                link.MarkAcknowledged(now);
                await _db.SaveChangesAsync(ct);
            }
            else
            {
                // Not lost: the sweep tries again, well inside Google's three days.
                _logger.LogWarning("Google Play subscription acknowledgement failed: {Error}", ack.Error.Message);
            }
        }

        return PlaySyncOutcome.Applied;
    }

    /// <summary>Applies a one-song purchase: the bought transcription, then the consume that closes it at Google.</summary>
    public async Task<Result<PlaySyncOutcome>> SyncOneTimeAsync(
        string productId, string purchaseToken, Guid? caller, CancellationToken ct)
    {
        if (!_play.IsConfigured)
            return BillingErrors.PlayNotConfigured;
        if (productId != SongProduct)
            return BillingErrors.PlayPurchaseNotFound;

        await using var lease = await _gate.AcquireAsync(Key(purchaseToken), ct);

        var read = await _play.GetOneTimePurchaseAsync(productId, purchaseToken, ct);
        if (read.IsFailure)
            return read.Error;
        var p = read.Value;

        var now = _clock.UtcNow;
        var link = await _db.GooglePlayPurchases.FirstOrDefaultAsync(x => x.PurchaseToken == purchaseToken, ct);
        var owner = await ResolveOwnerAsync(link, p.AccountId, linkedToken: null, caller, ct);
        if (owner.IsFailure)
            return owner.Error;
        if (owner.Value is not { } userId)
            return PlaySyncOutcome.Unclaimed;

        var firstSeen = link is null;
        if (link is null)
        {
            link = GooglePlayPurchase.Link(userId, purchaseToken, productId, isSubscription: false, now);
            _db.GooglePlayPurchases.Add(link);
        }
        link.Record(p.State, basePlanId: null, autoRenewing: false, expiryUtc: null, p.OrderId, p.Acknowledged, now);
        if (p.Consumed && !link.Consumed)
            link.MarkConsumed(now);

        if (p.State != OneTimePurchased)
        {
            await _db.SaveChangesAsync(ct);
            return p.State == "PENDING" ? PlaySyncOutcome.Pending : PlaySyncOutcome.Applied;
        }

        var fulfillments = new List<Fulfillment>();
        if (p.OrderId is { } orderId)
        {
            var fulfillment = await RecordOrderAsync(
                userId, productId, basePlanId: null, p.RegionCode, orderId, entitled: true, storeEnd: null, p.Raw, now, ct);
            if (fulfillment is not null)
                fulfillments.Add(fulfillment);
        }
        await PaymentFulfillment.SaveAsync(_db, fulfillments, ct);
        if (firstSeen)
            await SendReceiptsAsync(fulfillments, ct);

        if (!link.Consumed)
        {
            var consumed = await _play.ConsumeAsync(productId, purchaseToken, ct);
            if (consumed.IsSuccess)
            {
                link.MarkConsumed(now);
                await _db.SaveChangesAsync(ct);
            }
            else
            {
                _logger.LogWarning("Google Play one-song consume failed: {Error}", consumed.Error.Message);
            }
        }

        return PlaySyncOutcome.Applied;
    }

    private static string Key(string purchaseToken) => $"play:{purchaseToken}";

    /// <summary>
    /// The account a token belongs to: the one that claimed it first; else the account id the app set when buying
    /// (our user id); else, for a replacement token, the old token's account; else the caller. A caller who is not
    /// that account is refused, so one purchase can never serve two accounts.
    /// </summary>
    private async Task<Result<Guid?>> ResolveOwnerAsync(
        GooglePlayPurchase? link, string? accountId, string? linkedToken, Guid? caller, CancellationToken ct)
    {
        Guid? owner = link?.UserId;

        if (owner is null && Guid.TryParse(accountId, out var fromAccountId)
            && await _db.Users.AnyAsync(u => u.Id == fromAccountId, ct))
        {
            owner = fromAccountId;
        }

        if (owner is null && linkedToken is not null)
        {
            owner = await _db.GooglePlayPurchases
                .Where(p => p.PurchaseToken == linkedToken)
                .Select(p => (Guid?)p.UserId)
                .FirstOrDefaultAsync(ct);
        }

        owner ??= caller;

        if (caller is { } asking && owner is { } found && asking != found)
            return BillingErrors.PlayOtherAccount;
        return owner;
    }

    /// <summary>
    /// Records one order Google charged as a completed payment, once: the order id is the payment's unique reference.
    /// The amount is what the customer paid, tax included, read from the order; when the order cannot be read, the
    /// plan's own price stands in, and only for access Google says is current (so nothing refunded is counted).
    /// </summary>
    private async Task<Fulfillment?> RecordOrderAsync(
        Guid userId, string productId, string? basePlanId, string? regionCode, string orderId, bool entitled,
        DateTime? storeEnd, string raw, DateTime now, CancellationToken ct)
    {
        var recorded = _db.PaymentTransactions.Local.Any(t => t.Reference == orderId)
                       || await _db.PaymentTransactions.AnyAsync(t => t.Reference == orderId, ct);
        if (recorded)
            return null;

        var plan = await PlanForAsync(userId, productId, basePlanId, regionCode, ct);
        if (plan is null)
        {
            _logger.LogError("No active plan matches Google Play product {Product} ({BasePlan}); order not recorded.",
                productId, basePlanId);
            return null;
        }

        long amountMinor;
        string currency;
        var order = await _play.GetOrderAsync(orderId, ct);
        if (order.IsSuccess)
        {
            if (UnpaidOrderStates.Contains(order.Value.State))
                return null;
            amountMinor = order.Value.TotalMinor;
            currency = order.Value.Currency;
        }
        else
        {
            if (!entitled)
                return null;
            _logger.LogWarning("Google Play order could not be read ({Error}); recorded at the plan's price.", order.Error.Message);
            amountMinor = plan.AmountMinor;
            currency = plan.Currency;
        }

        // A $0.00 order (a same-plan sign-up before the old one ran out) moves no money; the dates follow Google anyway.
        if (amountMinor <= 0)
            return null;

        var tx = PaymentTransaction.ForStoreOrder(userId, plan.Id, PaymentProvider.GooglePlay, orderId, amountMinor, currency, now);
        _db.PaymentTransactions.Add(tx);

        var verification = new GatewayVerification(
            Succeeded: true, amountMinor, currency, ProviderReference: orderId, ProviderSubscriptionRef: productId,
            Raw: raw, Terminal: true, StorePeriodEndUtc: storeEnd);
        return await PaymentFulfillment.ApplyAsync(_db, tx, verification, now, ct);
    }

    /// <summary>
    /// The plan a Google Play product stands for, in the price set of the country Google charged in (the account's
    /// own country when Google does not say; naira when neither is known). It names the purchase in the library of
    /// plans and on receipts; the money recorded is always Google's.
    /// </summary>
    private async Task<Plan?> PlanForAsync(
        Guid userId, string productId, string? basePlanId, string? regionCode, CancellationToken ct)
    {
        var interval = productId == SongProduct
            ? BillingInterval.Single
            : basePlanId == YearlyBasePlan ? BillingInterval.Yearly : BillingInterval.Monthly;
        var choir = productId == ChoirProduct;

        var country = regionCode
                      ?? await _db.Users.Where(u => u.Id == userId).Select(u => u.Country).FirstOrDefaultAsync(ct);
        var tier = string.IsNullOrWhiteSpace(country) ? PlanEligibility.Tier.Naira : PlanEligibility.TierFor(country);

        var plans = (await _db.Plans.Where(p => p.IsActive && p.Interval == interval).ToListAsync(ct))
            .Where(p => p.IsChoir == choir)
            .OrderBy(p => p.Code, StringComparer.Ordinal)
            .ToList();
        return plans.FirstOrDefault(p => PlanEligibility.TierOf(p.Code, p.Currency) == tier) ?? plans.FirstOrDefault();
    }

    /// <summary>
    /// Makes the account's Pro (or its choir) run exactly as long as Google's access does. Every live token for the
    /// product counts (a new purchase beside an old one running out), and the one whose access runs latest governs.
    /// Access Google grants is never left waiting on an order record: a membership is started, or taken over from a
    /// lapsed website one, from the token alone. A membership running longer on time bought on the website is left
    /// to its own dates, and so is one Google Play does not pay for when Google grants nothing.
    /// </summary>
    private async Task FollowAsync(Guid userId, string productId, DateTime now, CancellationToken ct)
    {
        var stored = await _db.GooglePlayPurchases
            .Where(p => p.UserId == userId && p.ProductId == productId && p.ReplacedByToken == null)
            .ToListAsync(ct);
        var live = stored
            .Concat(_db.GooglePlayPurchases.Local.Where(p => p.UserId == userId && p.ProductId == productId))
            .Where(p => p.ReplacedByToken is null)
            .DistinctBy(p => p.Id)
            .ToList();

        var governing = live
            .Where(p => IsEntitledState(p.State) && p.ExpiryUtc > now)
            .OrderByDescending(p => p.ExpiryUtc)
            .FirstOrDefault();
        var plan = governing is null ? null : await PlanForAsync(userId, productId, governing.BasePlanId, null, ct);

        if (productId == ChoirProduct)
            await FollowChoirAsync(userId, governing, plan, now, ct);
        else
            await FollowProAsync(userId, governing, plan, now, ct);
    }

    private async Task FollowProAsync(Guid userId, GooglePlayPurchase? governing, Plan? plan, DateTime now, CancellationToken ct)
    {
        var sub = _db.Subscriptions.Local.FirstOrDefault(s => s.UserId == userId)
                  ?? await _db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == userId, ct);
        if (sub is { IsLifetime: true })
            return;

        if (governing?.ExpiryUtc is not { } end)
        {
            // Nothing granted: a membership Google Play pays for ends with Google's access (hold, refund, expiry).
            if (sub is not null && sub.Provider == PaymentProvider.GooglePlay)
                sub.FollowStore(Earlier(sub.CurrentPeriodEndUtc, now), canceled: true, now);
            return;
        }

        var canceled = !governing.AutoRenewing;
        if (sub is null)
        {
            if (plan is null)
                return;
            sub = Subscription.Start(userId, plan.Id, PaymentProvider.GooglePlay, now, end, governing.ProductId, now);
            _db.Subscriptions.Add(sub);
            if (canceled)
                sub.FollowStore(end, canceled, now);
            return;
        }

        if (sub.Provider != PaymentProvider.GooglePlay)
        {
            // Time bought on the website that still runs longer is kept as it is.
            if (sub.IsActiveAt(now) && sub.CurrentPeriodEndUtc >= end)
                return;
            sub.AttachPayment(PaymentProvider.GooglePlay, governing.ProductId, now);
        }

        if (plan is not null && sub.PlanId != plan.Id)
            sub.SwitchPlan(plan.Id, now);
        sub.FollowStore(end, canceled, now);
    }

    private async Task FollowChoirAsync(Guid userId, GooglePlayPurchase? governing, Plan? plan, DateTime now, CancellationToken ct)
    {
        var choir = _db.Choirs.Local.FirstOrDefault(c => c.OwnerId == userId)
                    ?? await _db.Choirs.FirstOrDefaultAsync(c => c.OwnerId == userId, ct);

        if (governing?.ExpiryUtc is not { } end)
        {
            if (choir is not null && choir.Provider == PaymentProvider.GooglePlay && choir.CurrentPeriodEndUtc > now)
                choir.FollowStore(now, now);
            return;
        }

        if (plan?.ChoirSeats is not { } seats)
            return;

        if (choir is null)
        {
            var name = await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName).FirstOrDefaultAsync(ct);
            _db.Choirs.Add(Choir.Start(
                userId, PaymentFulfillment.DefaultChoirName(name), ChoirAccess.NewInviteCode(), plan.Id, seats,
                PaymentProvider.GooglePlay, now, end, now));
            // A director leads their own choir, so a seat in someone else's is given up (as PaymentFulfillment does).
            var seat = await _db.ChoirMembers.FirstOrDefaultAsync(m => m.UserId == userId, ct);
            if (seat is not null)
                await ChoirAccess.DetachAsync(_db, seat, ct);
            return;
        }

        if (choir.Provider != PaymentProvider.GooglePlay || choir.PlanId != plan.Id)
        {
            if (choir.Provider != PaymentProvider.GooglePlay && choir.IsActiveAt(now) && choir.CurrentPeriodEndUtc >= end)
                return;
            choir.Renew(now, end, plan.Id, seats, PaymentProvider.GooglePlay, now);
            return;
        }

        if (choir.CurrentPeriodEndUtc != end)
            choir.FollowStore(end, now);
    }

    private static DateTime Earlier(DateTime a, DateTime b) => a < b ? a : b;

    private async Task SendReceiptsAsync(IReadOnlyList<Fulfillment> fulfillments, CancellationToken ct)
    {
        foreach (var receipt in fulfillments.Select(f => f.Receipt).OfType<FulfillmentReceipt>())
            await _email.SendSubscriptionReceiptAsync(receipt.Recipient, receipt.Receipt, ct);
    }
}
