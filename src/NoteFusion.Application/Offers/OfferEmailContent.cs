using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Offers;

/// <summary>One line of the email's price box: the plan's own price struck, the offer's beside it.</summary>
/// <param name="Name">"Pro Monthly" or "Pro Yearly".</param>
public sealed record OfferEmailPrice(string Name, BillingInterval Interval, long AmountMinor, long OfferAmountMinor);

/// <summary>
/// The facts one offer email states, for one person: the copy and layout live with the email template, like every
/// other email's (<c>BrandedEmailTemplate.Offer</c>).
/// </summary>
/// <param name="Words">The offer's words as stored; <c>{pct}</c> in them is written as <paramref name="PercentOff"/>.</param>
/// <param name="Prices">The person's own set (standard or regional dollars), the offer's plans only.</param>
/// <param name="OfferUrl">The button: <c>{site}/app?offer={key}&amp;m={token}</c> (no <c>m</c> in a preview or test).</param>
/// <param name="UnsubscribeUrl">The person's signed one-click unsubscribe link (the outreach notes' own).</param>
/// <param name="OpenPixelUrl">The 1×1 image that counts the open, <c>{api}/api/offers/o/{token}</c>; null in a preview or test.</param>
public sealed record OfferEmailContent(
    string Key,
    string Template,
    string Label,
    int PercentOff,
    OfferWords Words,
    DateOnly LastDay,
    IReadOnlyList<OfferEmailPrice> Prices,
    string OfferUrl,
    string UnsubscribeUrl,
    string? OpenPixelUrl = null);

/// <summary>An offer email as it goes out: what the console's preview shows and what the sender sends.</summary>
public sealed record RenderedOfferEmail(string Subject, string Preheader, string Html, string Text);

/// <summary>
/// Renders an offer email with the same template the sender uses, so the console's preview is what goes out.
/// </summary>
public interface IOfferEmailRenderer
{
    RenderedOfferEmail Render(EmailRecipient to, OfferEmailContent content);
}

/// <summary>Builds <see cref="OfferEmailContent"/> for one person from the offer and the dollar plans on sale.</summary>
public static class OfferEmailComposer
{
    /// <summary>Every Pro plan an offer could lower (both dollar sets, monthly and yearly), cheapest first.</summary>
    public static async Task<List<Plan>> OfferablePlansAsync(IApplicationDbContext db, CancellationToken ct)
    {
        var plans = await db.Plans.AsNoTracking()
            .Where(p => p.IsActive && p.ChoirSeats == null
                        && (p.Interval == BillingInterval.Monthly || p.Interval == BillingInterval.Yearly))
            .ToListAsync(ct);
        return plans.Where(OfferPlans.IsOfferable).OrderBy(p => p.AmountMinor).ToList();
    }

    /// <summary>The price box for one set ("standard" or "regional"): monthly first, the offer's plans only.</summary>
    public static IReadOnlyList<OfferEmailPrice> PricesFor(Offer offer, IEnumerable<Plan> plans, string set)
        => plans
            .Where(p => OfferPlans.Includes(offer, p) && OfferPlans.SetOf(p) == set)
            .GroupBy(p => p.Interval)
            .OrderBy(g => g.Key)
            .Select(g => g.OrderBy(p => p.AmountMinor).First())
            .Select(p => new OfferEmailPrice(
                OfferPlans.ShortName(p.Interval), p.Interval, p.AmountMinor, OfferPricing.Price(p.AmountMinor, offer.PercentOff)))
            .ToList();

    public static OfferEmailContent Compose(
        Offer offer, IEnumerable<Plan> plans, string set, string? token, string unsubscribeUrl, OfferSettings settings)
        => new(
            offer.Key,
            offer.Template,
            OfferTemplates.LabelOf(offer.Template),
            offer.PercentOff,
            new OfferWords(offer.Subject, offer.Preheader, offer.Headline, offer.Body),
            offer.LastDay,
            PricesFor(offer, plans, set),
            OfferUrl(settings, offer.Key, token),
            unsubscribeUrl,
            token is null ? null : OpenPixelUrl(settings, token));

    /// <summary>The image whose loading counts the email as opened (its own token, as the button's <c>m=</c>).</summary>
    public static string OpenPixelUrl(OfferSettings settings, string token)
        => $"{settings.ApiBaseUrl.TrimEnd('/')}/api/offers/o/{Uri.EscapeDataString(token)}";

    public static string OfferUrl(OfferSettings settings, string key, string? token)
        => $"{settings.SiteUrl.TrimEnd('/')}/app?offer={Uri.EscapeDataString(key)}"
           + (token is null ? string.Empty : $"&m={Uri.EscapeDataString(token)}");

    /// <summary>The person's own unsubscribe link, signed as the outreach notes' is.</summary>
    public static string UnsubscribeUrl(OfferSettings settings, IEmailUnsubscribeTokens tokens, Guid userId)
        => $"{settings.ApiBaseUrl.TrimEnd('/')}/api/email/unsubscribe?token={tokens.Create(userId)}";

    /// <summary>
    /// The link a preview shows: the unsubscribe page with no token (it says the link did not work), so clicking it in
    /// the console's preview unsubscribes nobody.
    /// </summary>
    public static string PreviewUnsubscribeUrl(OfferSettings settings)
        => $"{settings.ApiBaseUrl.TrimEnd('/')}/api/email/unsubscribe";
}
