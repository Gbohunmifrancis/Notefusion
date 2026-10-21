namespace NoteFusion.Application.Offers;

/// <summary>
/// Seasonal offers' settings: <c>Offers__Enabled</c> (the email worker; on by default), <c>Offers__BatchSize</c>,
/// <c>Offers__IntervalMinutes</c>, and the legal footer every offer email carries, <c>Email__PostalAddress</c> (one line:
/// the company's name and postal address). Until that is set, the preview and the test show a placeholder and Send is
/// refused.
/// </summary>
public sealed class OfferSettings
{
    /// <summary>The offer email worker sends; false holds every queue (the web prices still follow the offer).</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>The most offer emails one run sends; the quota and each person's sending hours are what really pace it.</summary>
    public int BatchSize { get; init; } = 200;

    public int IntervalMinutes { get; init; } = 5;

    /// <summary>The marketing mail's legal footer (<c>Email__PostalAddress</c>); blank until the owner sets it.</summary>
    public string PostalAddress { get; init; } = string.Empty;

    /// <summary>The API's public origin; the unsubscribe link points at its <c>/api/email/unsubscribe</c>.</summary>
    public string ApiBaseUrl { get; init; } = "https://api.notefusion.studio";

    /// <summary>The website; the email's button opens <c>{SiteUrl}/app?offer={key}&amp;m={token}</c>.</summary>
    public string SiteUrl { get; init; } = "https://notefusion.studio";

    public bool PostalAddressSet => !string.IsNullOrWhiteSpace(PostalAddress);
}
