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
/// <param name="LastCall">The last call: the countdown, "ends soon" and the usual price after it.</param>
/// <param name="CountdownUrl">The live countdown (an animated GIF made when the email is opened) to the person's own end.</param>
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
    string? OpenPixelUrl = null,
    bool LastCall = false,
    string? CountdownUrl = null);

/// <summary>An offer email as it goes out: what the console's preview shows and what the sender sends.</summary>
public sealed record RenderedOfferEmail(string Subject, string Preheader, string Html, string Text);

/// <summary>
/// Renders an offer email with the same template the sender uses, so the console's preview is what goes out.
/// </summary>
public interface IOfferEmailRenderer
{
    RenderedOfferEmail Render(EmailRecipient to, OfferEmailContent content);
}

/// <summary>
/// An offer's email as a notification: its subject as the title and its preview line as the body (the percent filled in),
/// cut to what a phone's notification shows. The web app's opens the offer (<c>/app?offer={key}&amp;m={token}</c>, its tap
/// counted like the email's button); a phone's opens the app's own Upgrade screen and reports its tap with the token.
/// </summary>
public static class OfferPushComposer
{
    public const int TitleMax = 65;
    public const int BodyMax = 178;

    public static (string Title, string Body) Words(Offer offer, OfferEmailRound round)
    {
        var words = round == OfferEmailRound.LastCall
            ? OfferEmailComposer.LastCallWordsOf(offer)
            : new OfferWords(offer.Subject, offer.Preheader, offer.Headline, offer.Body);
        return (Clip(OfferTemplates.Fill(words.Subject, offer.PercentOff), TitleMax), Clip(OfferTemplates.Fill(words.Preheader, offer.PercentOff), BodyMax));
    }

    /// <summary>The web app's notification opens the offer on its own page, the token counting the tap.</summary>
    public static string WebUrl(Offer offer, string token)
        => $"/app?offer={Uri.EscapeDataString(offer.Key)}&m={Uri.EscapeDataString(token)}";

    /// <summary>Its tag: one notification per offer and round in a browser, a second one replacing the first.</summary>
    public static string Tag(Offer offer, OfferEmailRound round)
        => $"nf-offer-{offer.Key}-{(round == OfferEmailRound.LastCall ? "last-call" : "launch")}";

    private static string Clip(string text, int max)
        => text.Length <= max ? text : text[..(max - 1)].TrimEnd() + "…";
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
        Offer offer, IEnumerable<Plan> plans, string set, string? token, string unsubscribeUrl, OfferSettings settings,
        OfferEmailRound round = OfferEmailRound.Launch)
    {
        var lastCall = round == OfferEmailRound.LastCall;
        return new(
            offer.Key,
            offer.Template,
            OfferTemplates.LabelOf(offer.Template),
            offer.PercentOff,
            lastCall ? LastCallWordsOf(offer) : new OfferWords(offer.Subject, offer.Preheader, offer.Headline, offer.Body),
            offer.LastDay,
            PricesFor(offer, plans, set),
            OfferUrl(settings, offer.Key, token),
            unsubscribeUrl,
            token is null ? null : OpenPixelUrl(settings, token),
            lastCall,
            lastCall ? CountdownUrl(settings, offer.Key, token) : null);
    }

    /// <summary>The last call's words: the offer's own once written, else its template's.</summary>
    public static OfferWords LastCallWordsOf(Offer offer)
    {
        if (offer.LastCallSubject is { } subject && offer.LastCallPreheader is { } preheader
            && offer.LastCallHeadline is { } headline && offer.LastCallBody is { } body)
            return new OfferWords(subject, preheader, headline, body);
        return (OfferTemplates.Find(offer.Template) ?? OfferTemplates.HalloweenTemplate).LastCallWords;
    }

    /// <summary>
    /// The live countdown to the person's own end (their token names them; a preview or test counts to the UK's).
    /// A query string, not a path: some mail apps cache an image by its path alone.
    /// </summary>
    public static string CountdownUrl(OfferSettings settings, string key, string? token)
        => $"{settings.ApiBaseUrl.TrimEnd('/')}/api/offers/countdown?o={Uri.EscapeDataString(key)}"
           + (token is null ? string.Empty : $"&m={Uri.EscapeDataString(token)}");

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
