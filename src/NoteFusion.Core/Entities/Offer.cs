using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A seasonal Pro discount (Money › Offers): a percentage off Pro Monthly and/or Pro Yearly on the dollar plans,
/// from <see cref="StartsAtUtc"/> until midnight at the end of <see cref="LastDay"/> in each person's own time zone, and
/// the email that tells people. A <see cref="Template"/> (<c>halloween</c>, <c>christmas</c>) is only a skin: the
/// email's header art, colours and default words.
/// </summary>
/// <remarks>
/// <para>
/// An offer is a price, not a plan: checkout charges the plan's own row less <see cref="PercentOff"/> (rounded down) and
/// marks the payment with the offer's id; fulfilment, the ledger and the receipt read it as an ordinary Pro payment.
/// </para>
/// <para>
/// The email's words are locked once sending starts (<see cref="SendStartedAtUtc"/>), so what was sent stays on the
/// record. At most one enabled offer at a time: the command that switches one on checks the windows
/// (<see cref="EarliestEndUtc"/>..<see cref="LatestEndUtc"/>) do not overlap.
/// </para>
/// </remarks>
public sealed class Offer : BaseEntity
{
    public const int KeyMaxLength = 60;
    public const int NameMaxLength = 80;
    public const int TemplateMaxLength = 20;
    public const int EmailMaxLength = 320;
    public const int SubjectMaxLength = 120;
    public const int PreheaderMaxLength = 200;
    public const int HeadlineMaxLength = 120;
    public const int BodyMaxLength = 1200;
    public const int MinPercentOff = 5;
    public const int MaxPercentOff = 70;

    /// <summary>The easternmost offset in use (UTC+14, Kiribati): the first place a day ends.</summary>
    private static readonly TimeSpan EarliestOffset = TimeSpan.FromHours(14);

    /// <summary>The westernmost offset in use (UTC−12): the last place a day ends.</summary>
    private static readonly TimeSpan LatestOffset = TimeSpan.FromHours(-12);

    private Offer() { } // EF Core

    /// <summary>The offer's slug (<c>halloween-2026</c>): what the email's link and the checkout name it by. Unique.</summary>
    public string Key { get; private set; } = string.Empty;

    /// <summary>What the console calls it ("Halloween 2026").</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>The skin: <c>halloween</c> or <c>christmas</c>.</summary>
    public string Template { get; private set; } = string.Empty;

    /// <summary>Off every price in the offer, rounded down to the plan's own ending (5–70).</summary>
    public int PercentOff { get; private set; }

    public bool IncludesMonthly { get; private set; }
    public bool IncludesYearly { get; private set; }

    /// <summary>The moment it starts, the same for everyone.</summary>
    public DateTime StartsAtUtc { get; private set; }

    /// <summary>The last day it runs: it ends at midnight after this day, wherever each person is.</summary>
    public DateOnly LastDay { get; private set; }

    /// <summary>The switch: off, nothing shows and nothing is charged at the offer price.</summary>
    public bool Enabled { get; private set; }

    public string Subject { get; private set; } = string.Empty;
    public string Preheader { get; private set; } = string.Empty;
    public string Headline { get; private set; } = string.Empty;

    /// <summary>The email's opening paragraphs, split on a blank line; <c>{pct}</c> reads as the percent.</summary>
    public string Body { get; private set; } = string.Empty;

    /// <summary>When the admin pressed Send (the audience was queued then); null until then. Locks the words.</summary>
    public DateTime? SendStartedAtUtc { get; private set; }

    /// <summary>The admin who pressed Send.</summary>
    public Guid? SendStartedBy { get; private set; }

    /// <summary>Sending held by an admin: the queue waits until it is resumed.</summary>
    public bool SendPaused { get; private set; }

    public bool SendIncludesFree { get; private set; }
    public bool SendIncludesLapsed { get; private set; }
    public bool SendIncludesProNow { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    /// <summary>The admin who created it. No foreign key: like the audit log, the row outlives their account.</summary>
    public Guid CreatedBy { get; private set; }

    /// <summary>Snapshot of that admin's email, as the audit log keeps it.</summary>
    public string? CreatedByEmail { get; private set; }

    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>True once Send was pressed: the words are what was sent and can no longer change.</summary>
    public bool WordsLocked => SendStartedAtUtc is not null;

    /// <summary>Midnight after <see cref="LastDay"/> at UTC+14: before this it has ended nowhere.</summary>
    public DateTime EarliestEndUtc => EndAtOffset(EarliestOffset);

    /// <summary>Midnight after <see cref="LastDay"/> at UTC−12: from this it has ended everywhere.</summary>
    public DateTime LatestEndUtc => EndAtOffset(LatestOffset);

    public bool HasStarted(DateTime utcNow) => utcNow >= StartsAtUtc;

    /// <summary>Over for everyone, wherever they are.</summary>
    public bool HasEndedEverywhere(DateTime utcNow) => utcNow >= LatestEndUtc;

    /// <summary>Whether this offer's window could share a moment with <paramref name="other"/>'s anywhere in the world.</summary>
    public bool Overlaps(Offer other) => WindowsOverlap(StartsAtUtc, LastDay, other.StartsAtUtc, other.LastDay);

    /// <summary>
    /// Whether two offers' windows (each from its start to its last day's midnight at UTC−12, the last place it ends)
    /// share a moment.
    /// </summary>
    public static bool WindowsOverlap(DateTime startsA, DateOnly lastDayA, DateTime startsB, DateOnly lastDayB)
        => startsA < LatestEndFor(lastDayB) && startsB < LatestEndFor(lastDayA);

    /// <summary>The midnight after <paramref name="lastDay"/> at UTC−12: from then on it has ended everywhere.</summary>
    public static DateTime LatestEndFor(DateOnly lastDay)
        => DateTime.SpecifyKind(lastDay.AddDays(1).ToDateTime(TimeOnly.MinValue) - LatestOffset, DateTimeKind.Utc);

    public static Offer Create(
        string key,
        string name,
        string template,
        int percentOff,
        bool includesMonthly,
        bool includesYearly,
        DateTime startsAtUtc,
        DateOnly lastDay,
        string subject,
        string preheader,
        string headline,
        string body,
        Guid createdBy,
        string? createdByEmail,
        DateTime utcNow)
    {
        var offer = new Offer
        {
            Id = Guid.NewGuid(),
            Key = Guard.NotNullOrWhiteSpace(key),
            CreatedAtUtc = utcNow,
            CreatedBy = Guard.AgainstEmpty(createdBy),
            CreatedByEmail = createdByEmail,
        };
        offer.SetTerms(name, template, percentOff, includesMonthly, includesYearly, startsAtUtc, lastDay, utcNow);
        offer.SetWords(subject, preheader, headline, body, utcNow);
        return offer;
    }

    /// <summary>The key, re-derived while nothing has been sent that names it.</summary>
    public void Rekey(string key, DateTime utcNow)
    {
        if (WordsLocked)
            throw new InvalidOperationException("An offer's key cannot change once its email has been sent.");
        Key = Guard.NotNullOrWhiteSpace(key);
        UpdatedAtUtc = utcNow;
    }

    /// <summary>Name, skin, price and dates. The caller decides what may still change (see the update command).</summary>
    public void SetTerms(
        string name, string template, int percentOff, bool includesMonthly, bool includesYearly,
        DateTime startsAtUtc, DateOnly lastDay, DateTime utcNow)
    {
        if (percentOff is < MinPercentOff or > MaxPercentOff)
            throw new ArgumentOutOfRangeException(nameof(percentOff), percentOff, "Percent off must be 5 to 70.");
        if (!includesMonthly && !includesYearly)
            throw new ArgumentException("An offer includes at least one of Pro Monthly and Pro Yearly.");

        Name = Guard.NotNullOrWhiteSpace(name).Trim();
        Template = Guard.NotNullOrWhiteSpace(template).Trim().ToLowerInvariant();
        PercentOff = percentOff;
        IncludesMonthly = includesMonthly;
        IncludesYearly = includesYearly;
        StartsAtUtc = startsAtUtc.Kind switch
        {
            DateTimeKind.Local => startsAtUtc.ToUniversalTime(),
            DateTimeKind.Unspecified => DateTime.SpecifyKind(startsAtUtc, DateTimeKind.Utc),
            _ => startsAtUtc,
        };
        LastDay = lastDay;
        UpdatedAtUtc = utcNow;
    }

    /// <summary>The email's words. Refused once sending has started.</summary>
    public void SetWords(string subject, string preheader, string headline, string body, DateTime utcNow)
    {
        if (WordsLocked)
            throw new InvalidOperationException("An offer's words cannot change once its email has been sent.");
        Subject = Guard.NotNullOrWhiteSpace(subject).Trim();
        Preheader = Guard.NotNullOrWhiteSpace(preheader).Trim();
        Headline = Guard.NotNullOrWhiteSpace(headline).Trim();
        Body = Guard.NotNullOrWhiteSpace(body).Trim();
        UpdatedAtUtc = utcNow;
    }

    public void SetEnabled(bool enabled, DateTime utcNow)
    {
        Enabled = enabled;
        UpdatedAtUtc = utcNow;
    }

    /// <summary>Send was pressed: the audience (these groups) is queued and the words are locked.</summary>
    public void StartSending(bool free, bool lapsed, bool proNow, Guid adminId, DateTime utcNow)
    {
        if (SendStartedAtUtc is not null)
            throw new InvalidOperationException("This offer's email has already been sent.");
        SendStartedAtUtc = utcNow;
        SendStartedBy = Guard.AgainstEmpty(adminId);
        SendIncludesFree = free;
        SendIncludesLapsed = lapsed;
        SendIncludesProNow = proNow;
        SendPaused = false;
        UpdatedAtUtc = utcNow;
    }

    public void SetSendPaused(bool paused, DateTime utcNow)
    {
        SendPaused = paused;
        UpdatedAtUtc = utcNow;
    }

    private DateTime EndAtOffset(TimeSpan offset)
        => DateTime.SpecifyKind(LastDay.AddDays(1).ToDateTime(TimeOnly.MinValue) - offset, DateTimeKind.Utc);
}
