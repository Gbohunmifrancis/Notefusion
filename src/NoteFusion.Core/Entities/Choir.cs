using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A choir on the choir plan: one director pays, and up to <see cref="Seats"/> singers who join with its
/// invite code are Pro while the choir's paid period runs. The period lives here rather than on the
/// director's <c>Subscription</c> row, so a director can hold a Pro membership of their own beside the
/// choir and neither purchase ever converts time bought for the other.
/// </summary>
/// <remarks>
/// Nothing renews by itself (as with Pro): the director buys again to add a period after the time left, except a
/// plan bought through Google Play, which Google renews and whose period follows it (<see cref="FollowStore"/>).
/// <see cref="Version"/> is a concurrency token so two payments landing at once both stack.
/// </remarks>
public class Choir : BaseEntity
{
    public const int NameMaxLength = 80;
    public const int InviteCodeLength = 8;

    private Choir() { } // persistence

    /// <summary>The director: the account that paid, and the only one that can manage the choir.</summary>
    public Guid OwnerId { get; private set; }
    public string Name { get; private set; } = string.Empty;

    /// <summary>The code singers join with. Regenerating it stops the old one working.</summary>
    public string InviteCode { get; private set; } = string.Empty;

    /// <summary>The choir plan last paid for.</summary>
    public Guid PlanId { get; private set; }

    /// <summary>Which gateway took the latest payment.</summary>
    public PaymentProvider? Provider { get; private set; }

    /// <summary>Singers who may join besides the director.</summary>
    public int Seats { get; private set; }

    public DateTime CurrentPeriodStartUtc { get; private set; }
    public DateTime CurrentPeriodEndUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Bumped on every change and checked on every save, like <c>Subscription.Version</c>.</summary>
    public int Version { get; private set; }

    /// <summary>Members are Pro, and the shared library open, while the paid period runs.</summary>
    public bool IsActiveAt(DateTime utcNow) => utcNow < CurrentPeriodEndUtc;

    public static Choir Start(
        Guid ownerId, string name, string inviteCode, Guid planId, int seats, PaymentProvider? provider,
        DateTime periodStartUtc, DateTime periodEndUtc, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            OwnerId = Guard.AgainstEmpty(ownerId),
            Name = CleanName(name),
            InviteCode = Guard.NotNullOrWhiteSpace(inviteCode),
            PlanId = Guard.AgainstEmpty(planId),
            Seats = Guard.InRange(seats, 1, 1000),
            Provider = provider,
            CurrentPeriodStartUtc = periodStartUtc,
            CurrentPeriodEndUtc = periodEndUtc > periodStartUtc
                ? periodEndUtc
                : throw new ArgumentException("Period end must be after start.", nameof(periodEndUtc)),
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

    /// <summary>A new paid period, on the plan just bought (monthly or yearly), from <paramref name="periodStartUtc"/>.</summary>
    public void Renew(
        DateTime periodStartUtc, DateTime periodEndUtc, Guid planId, int seats, PaymentProvider? provider, DateTime utcNow)
    {
        if (periodEndUtc <= periodStartUtc)
            throw new ArgumentException("Period end must be after start.", nameof(periodEndUtc));

        CurrentPeriodStartUtc = periodStartUtc;
        CurrentPeriodEndUtc = periodEndUtc;
        PlanId = Guard.AgainstEmpty(planId);
        Seats = Guard.InRange(seats, 1, 1000);
        Provider = provider;
        Touch(utcNow);
    }

    /// <summary>
    /// Follows a store that renews the choir's plan itself (Google Play): the period ends when the store says,
    /// later or earlier than before (a renewal, a grace period, a refund or account hold).
    /// </summary>
    public void FollowStore(DateTime periodEndUtc, DateTime utcNow)
    {
        CurrentPeriodEndUtc = periodEndUtc;
        if (CurrentPeriodStartUtc > periodEndUtc)
            CurrentPeriodStartUtc = periodEndUtc;
        Touch(utcNow);
    }

    public void Rename(string name, DateTime utcNow)
    {
        Name = CleanName(name);
        Touch(utcNow);
    }

    public void ReplaceInviteCode(string inviteCode, DateTime utcNow)
    {
        InviteCode = Guard.NotNullOrWhiteSpace(inviteCode);
        Touch(utcNow);
    }

    private static string CleanName(string name)
    {
        var trimmed = Guard.NotNullOrWhiteSpace(name).Trim();
        return trimmed.Length > NameMaxLength ? trimmed[..NameMaxLength].TrimEnd() : trimmed;
    }

    private void Touch(DateTime utcNow)
    {
        UpdatedAtUtc = utcNow;
        Version++;
    }
}

/// <summary>
/// A singer in a <see cref="Choir"/>. One row per account at most (a unique index): an account sings in one
/// choir. The director is not a row here — they are the choir's <see cref="Choir.OwnerId"/> and take no seat.
/// </summary>
public class ChoirMember : BaseEntity
{
    private ChoirMember() { } // persistence

    public Guid ChoirId { get; private set; }
    public Guid UserId { get; private set; }
    public DateTime JoinedAtUtc { get; private set; }

    public static ChoirMember Create(Guid choirId, Guid userId, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            ChoirId = Guard.AgainstEmpty(choirId),
            UserId = Guard.AgainstEmpty(userId),
            JoinedAtUtc = utcNow
        };
}
