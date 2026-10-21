using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Offers;

/// <summary>One account an offer's email could go to: its group, its price set, and when it was last seen.</summary>
public sealed record OfferAudienceMember(Guid UserId, OfferEmailGroup Group, string Set, DateTime? LastSeenUtc);

/// <summary>Accounts never sent an offer, by the first reason that applies to each.</summary>
public sealed record OfferAudienceExclusions(int Naira, int NoCountry, int EmailOff, int StoreOrChoir, int RecentNote);

/// <summary>Everyone the offer could reach (all three groups), and who is left out and why.</summary>
public sealed record OfferAudienceReading(IReadOnlyList<OfferAudienceMember> Members, OfferAudienceExclusions Excluded)
{
    /// <summary>The members in the ticked groups, in the order the queue sends: lapsed, free by last seen (newest first), Pro now.</summary>
    public IReadOnlyList<OfferAudienceMember> Chosen(bool free, bool lapsed, bool proNow)
        => Members
            .Where(m => m.Group switch
            {
                OfferEmailGroup.Free => free,
                OfferEmailGroup.Lapsed => lapsed,
                _ => proNow,
            })
            .OrderBy(m => m.Group)
            .ThenByDescending(m => m.LastSeenUtc ?? DateTime.MinValue)
            .ToList();
}

/// <summary>
/// Who an offer's email is for, read the same way for the console's counts and for the queue Send makes.
/// </summary>
/// <remarks>
/// <para>
/// Only active accounts with a verified address are ever counted. Then, the first that applies: no country on the
/// account (<c>NoCountry</c>); priced in naira, Nigeria (<c>Naira</c>); Pro through Google Play or a choir
/// (<c>StoreOrChoir</c>: Google renews it, or a director pays); email from us switched off (<c>EmailOff</c>, the
/// founder's notes' own <c>EmailOptOut</c>); a founder's note emailed in the last 7 days (<c>RecentNote</c>). Admins are
/// not left out.
/// </para>
/// <para>
/// The rest fall in one group: <see cref="OfferEmailGroup.ProNow"/> with a running membership of their own billed on
/// the web (lifetime access has nothing to buy and is left out); <see cref="OfferEmailGroup.Lapsed"/> when they had one
/// that has ended; <see cref="OfferEmailGroup.Free"/> when they never had one. Small per-account facts are read once
/// and folded in memory, as the outreach sweep does, so the rules read the same on Npgsql and on SQLite.
/// </para>
/// </remarks>
public static class OfferAudience
{
    public static async Task<OfferAudienceReading> ReadAsync(IApplicationDbContext db, DateTime utcNow, CancellationToken ct)
    {
        var users = await db.Users.AsNoTracking()
            .Where(u => u.IsActive && u.EmailVerified)
            .Select(u => new { u.Id, u.Country, Seen = u.LastSeenAtUtc ?? u.LastLoginAt })
            .ToListAsync(ct);

        var subscriptions = (await db.Subscriptions.AsNoTracking()
                .Select(s => new { s.UserId, s.Provider, s.Status, s.CurrentPeriodEndUtc })
                .ToListAsync(ct))
            .GroupBy(s => s.UserId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(s => s.CurrentPeriodEndUtc).First());
        var choir = await ChoirAccess.ActiveChoirUserIdsAsync(db, utcNow, ct);
        var optedOut = (await db.EmailOptOuts.Select(o => o.UserId).ToListAsync(ct)).ToHashSet();
        var noteSince = utcNow - OutreachRules.Spacing;
        var recentNote = (await db.OutreachMessages
                .Where(m => m.Channel == OutreachChannel.Email && m.Status == OutreachStatus.Sent && m.SentAtUtc > noteSince)
                .Select(m => m.UserId)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet();

        int naira = 0, noCountry = 0, emailOff = 0, storeOrChoir = 0, recent = 0;
        var members = new List<OfferAudienceMember>();
        foreach (var u in users)
        {
            if (string.IsNullOrWhiteSpace(u.Country))
            {
                noCountry++;
                continue;
            }
            if (OfferPlans.SetFor(u.Country) is not { } set)
            {
                naira++;
                continue;
            }

            OfferEmailGroup group;
            if (subscriptions.TryGetValue(u.Id, out var sub)
                && sub.Status is SubscriptionStatus.Active or SubscriptionStatus.Canceled
                && utcNow < sub.CurrentPeriodEndUtc)
            {
                if (sub.Provider == PaymentProvider.GooglePlay)
                {
                    storeOrChoir++;
                    continue;
                }
                if (sub.CurrentPeriodEndUtc >= Core.Entities.Billing.Subscription.LifetimeEndUtc)
                    continue;
                group = OfferEmailGroup.ProNow;
            }
            else if (choir.Contains(u.Id))
            {
                storeOrChoir++;
                continue;
            }
            else
            {
                group = sub is null ? OfferEmailGroup.Free : OfferEmailGroup.Lapsed;
            }

            if (optedOut.Contains(u.Id))
            {
                emailOff++;
                continue;
            }
            if (recentNote.Contains(u.Id))
            {
                recent++;
                continue;
            }

            members.Add(new OfferAudienceMember(u.Id, group, set, u.Seen));
        }

        return new OfferAudienceReading(members, new OfferAudienceExclusions(naira, noCountry, emailOff, storeOrChoir, recent));
    }
}
