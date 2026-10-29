using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Offers;
using NoteFusion.Core.Enums;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// A seasonal offer's email (<see cref="OfferEmailContent"/>, board p-halloween-offer P1): the branded shell with the
/// season's night header (its art, the live wordmark and "Halloween offer · until 31 October"), the headline, the
/// greeting and the offer's paragraphs, the price box in the person's own set (the usual price struck, the offer's
/// beside it), what Pro gives, one blue button, the end in their own time, and the marketing footer: why they got it,
/// the one-click unsubscribe and the company's postal address (<c>Email__PostalAddress</c>). A
/// <c>prefers-color-scheme: dark</c> block puts the body on the night canvas where the client honours it.
/// </summary>
/// <remarks>
/// The last call (<see cref="OfferEmailContent.LastCall"/>) is the same email near the end: "ends 31 October" in the
/// header, a live countdown under the headline (an animated GIF the API draws when it is opened, to the person's own
/// midnight), the usual price it goes back to, and a button that says so.
/// Every value from outside (the name, the admin's words, the links) is HTML-encoded here; the words' only markup is
/// the "30% off" made bold after encoding.
/// </remarks>
public sealed partial class BrandedEmailTemplate
{
    /// <summary>What the footer shows until <c>Email__PostalAddress</c> is set (the console refuses Send meanwhile).</summary>
    public const string PostalAddressPlaceholder = "[the company's postal address]";

    private const string OkTick = "#16a34a";

    /// <summary>A template's colours: the header's glow, the line under the wordmark, the price box's tint and label.</summary>
    private sealed record OfferSkin(
        string Glow, string Line, string BoxFill, string BoxBorder, string Tag, string DarkBoxFill, string DarkBoxBorder, string DarkTag);

    private static readonly OfferSkin HalloweenSkin = new(
        "rgba(242,138,58,0.16)", "#EDE6CF", "#FAF3EF", "#EDD6C9", "#AC4E1A", "#2E231F", "#5C3B25", "#EDE6CF");

    private static readonly OfferSkin ChristmasSkin = new(
        "rgba(46,138,102,0.20)", "#F3DFB4", "#F1F7F4", "#C7DED4", "#1F6B50", "#13261F", "#22533F", "#F3DFB4");

    [GeneratedRegex(@"\d{1,2}% off")]
    private static partial Regex PercentOff();

    [GeneratedRegex(@"\r?\n\s*\r?\n")]
    private static partial Regex BlankLine();

    public EmailMessage Offer(EmailRecipient to, OfferEmailContent offer)
    {
        var rendered = RenderOffer(to, offer);
        return new EmailMessage(
            to.Email,
            to.Name,
            rendered.Subject,
            rendered.Html,
            rendered.Text,
            ReplyTo: _settings.SupportEmail,
            Headers: new Dictionary<string, string>
            {
                ["List-Unsubscribe"] = $"<{offer.UnsubscribeUrl}>",
                ["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click",
            });
    }

    public RenderedOfferEmail RenderOffer(EmailRecipient to, OfferEmailContent offer)
    {
        var skin = offer.Template == OfferTemplates.Christmas ? ChristmasSkin : HalloweenSkin;
        var pct = offer.PercentOff;
        var subject = OfferTemplates.Fill(offer.Words.Subject, pct);
        var preheader = OfferTemplates.Fill(offer.Words.Preheader, pct);
        var headline = OfferTemplates.Fill(offer.Words.Headline, pct);
        var paragraphs = BlankLine().Split(OfferTemplates.Fill(offer.Words.Body, pct).Trim())
            .Select(p => p.Trim())
            .Where(p => p.Length > 0)
            .ToList();
        var first = FirstName(to);
        var greeting = first is null ? "Hello," : $"Hello {first},";
        var until = offer.LastDay.ToString("d MMMM", CultureInfo.InvariantCulture);
        var endsOn = offer.LastDay.ToString("dddd d MMMM", CultureInfo.InvariantCulture);
        var buys = (offer.Prices.Any(p => p.Interval == BillingInterval.Monthly), offer.Prices.Any(p => p.Interval == BillingInterval.Yearly)) switch
        {
            (true, false) => "one month",
            (false, true) => "one year",
            _ => "one month or one year",
        };
        var usual = string.Join(" or ", offer.Prices.Select(p => $"{Usd(p.AmountMinor)} a {(p.Interval == BillingInterval.Yearly ? "year" : "month")}"));
        var endLine = offer.LastCall
            ? $"When the clock runs out at midnight on {endsOn}, your time, Pro goes back to its usual price{(usual.Length > 0 ? $" of {usual}" : string.Empty)}. Each payment buys {buys} of Pro; nothing renews by itself."
            : $"The offer ends at midnight on {endsOn}, your time. Each payment buys {buys} of Pro; nothing renews by itself.";
        var button = offer.LastCall ? $"Get {pct}% off before midnight" : $"Get {pct}% off Pro";
        var headerLine = offer.LastCall ? $"{offer.Label} · ends {until}" : $"{offer.Label} · until {until}";
        // The live countdown (the last call only): a picture, so it plays in every mail app; its words say the same.
        var countdown = offer.CountdownUrl is { } countdownUrl
            ? $"""

                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px">
                            <tr>
                              <td align="center" bgcolor="#0E121A" style="padding:12px 8px 8px;border-radius:14px;background-color:#0E121A">
                                <div style="font-family:{FontStack};font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:{skin.Line};padding-bottom:6px">The offer ends in</div>
                                <img src="{Encode(countdownUrl)}" width="480" height="140" alt="{Encode($"Ends at midnight on {endsOn}, your time")}" border="0" style="display:block;margin:0 auto;border:0;outline:none;width:100%;max-width:480px;height:auto" />
                              </td>
                            </tr>
                          </table>
              """
            : string.Empty;
        var address = string.IsNullOrWhiteSpace(_settings.PostalAddress) ? PostalAddressPlaceholder : _settings.PostalAddress.Trim();
        // The 1×1 image that counts the open (real sends only; never in a preview or a test).
        var pixel = offer.OpenPixelUrl is { } pixelUrl
            ? $"<img src=\"{Encode(pixelUrl)}\" width=\"1\" height=\"1\" alt=\"\" style=\"display:block;width:1px;height:1px;border:0\" />"
            : string.Empty;
        var site = _settings.AppUrl.Replace("https://", string.Empty).Replace("http://", string.Empty).TrimEnd('/');
        var art = SeasonArtUrl(offer.Template);

        var copy = $"margin:0 0 14px;font-family:{FontStack};font-size:16px;line-height:1.65;color:{Muted}";
        var body = new StringBuilder();
        body.Append($"""<p class="nf-copy" style="{copy}">{Encode(greeting)}</p>""");
        for (var i = 0; i < paragraphs.Count; i++)
        {
            var paragraph = PercentOff().Replace(Encode(paragraphs[i]).Replace("\n", "<br>"), m => $"<strong style=\"color:{Ink}\">{m.Value}</strong>");
            body.Append($"""<p class="nf-copy" style="{copy}{(i == paragraphs.Count - 1 ? ";margin:0" : string.Empty)}">{paragraph}</p>""");
        }

        var rows = new StringBuilder();
        for (var i = 0; i < offer.Prices.Count; i++)
        {
            var price = offer.Prices[i];
            var pad = i == 0 ? "0 0 0" : "12px 0 0";
            var period = price.Interval == BillingInterval.Yearly
                ? $"for one year<br>{Encode(Usd(PerMonth(price.OfferAmountMinor)))} a month"
                : "for one month";
            rows.Append($"""

                              <tr>
                                <td class="nf-ink" style="padding:{pad};font-family:{FontStack};font-size:15px;font-weight:600;color:{Ink};white-space:nowrap;vertical-align:top">{Encode(price.Name)}</td>
                                <td align="right" style="padding:{pad};font-family:{FontStack};vertical-align:top">
                                  <span class="nf-faint" style="font-size:14px;color:{Faint};text-decoration:line-through">{Encode(Usd(price.AmountMinor))}</span>&nbsp;
                                  <span class="nf-ink" style="font-size:18px;font-weight:700;color:{Ink}">{Encode(Usd(price.OfferAmountMinor))}</span>
                                  <div class="nf-muted" style="font-size:12.5px;color:{Muted};padding-top:1px">{period}</div>
                                </td>
                              </tr>
              """);
        }

        string Tick(string cell) => $"""

                          <tr>
                            <td width="26" valign="top" class="nf-ok" style="padding:7px 0 0;font-family:{FontStack};font-size:16px;font-weight:700;color:{OkTick};line-height:1.5">&#10003;</td>
                            <td class="nf-muted" style="padding:7px 0 0;font-family:{FontStack};font-size:15px;line-height:1.5;color:{Muted}">{cell}</td>
                          </tr>
            """;
        var em = $"font-style:normal;color:{Ink}";
        var ticks = Tick("Whole songs up to six minutes, twenty a month")
                    + Tick($"Alto, tenor and bass under any tune, and <em style=\"{em}\">Learn my part</em> to rehearse yours")
                    + Tick($"<em style=\"{em}\">Sing it back</em>: every note of your part, marked")
                    + Tick("The fast lane: your songs never wait in a queue");

        var html = $$"""
            <!DOCTYPE html>
            <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width,initial-scale=1" />
              <meta name="x-apple-disable-message-reformatting" />
              <meta name="color-scheme" content="light dark" />
              <meta name="supported-color-schemes" content="light dark" />
              <title>{{Encode(subject)}}</title>
              <style>
                @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
                :root { color-scheme: light dark; supported-color-schemes: light dark; }
                a { color: {{Blue}}; }
                @media only screen and (max-width:620px) {
                  .nf-shell { width: 100% !important; }
                  .nf-pad { padding-left: 24px !important; padding-right: 24px !important; }
                  .nf-hpad { padding-left: 16px !important; padding-right: 16px !important; }
                  .nf-h1 { font-size: 24px !important; }
                  .nf-art { width: 240px !important; height: 103px !important; }
                }
                /* Dark mode, for the clients that honour it (Apple Mail, iOS Mail, Outlook for Mac): the body goes to the
                   night canvas; the header is night already. Gmail's apps ignore this and invert the light body themselves. */
                @media (prefers-color-scheme: dark) {
                  .nf-canvas { background-color:#07090E !important; }
                  .nf-body { background-color:#0E121A !important; border-color:#1E2533 !important; }
                  .nf-foot { background-color:#121722 !important; border-color:#1E2533 !important; }
                  .nf-ink, .nf-h1 { color:#F3F6FB !important; }
                  .nf-copy, .nf-muted { color:#9AA4B8 !important; }
                  .nf-copy strong, .nf-muted em { color:#F3F6FB !important; }
                  .nf-faint { color:#8089A0 !important; }
                  .nf-box { background-color:{{skin.DarkBoxFill}} !important; border-color:{{skin.DarkBoxBorder}} !important; }
                  .nf-tag { color:{{skin.DarkTag}} !important; }
                  .nf-ok { color:#3DDC97 !important; }
                  a.nf-link { color:#5C9BFF !important; }
                }
              </style>
            </head>
            <body class="nf-canvas" style="margin:0;padding:0;background-color:{{Canvas}};font-family:{{FontStack}};-webkit-font-smoothing:antialiased">
              <div style="display:none;font-size:1px;color:{{Canvas}};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">{{Encode(preheader)}}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
              <table role="presentation" class="nf-canvas" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="{{Canvas}}" style="background-color:{{Canvas}}">
                <tr>
                  <td align="center" style="padding:32px 12px">
                    <table role="presentation" class="nf-shell" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px">

                      <!-- Seasonal header: the night canvas (Outlook keeps the bgcolor), the mark in its costume, the season's line. -->
                      <tr>
                        <td align="center" class="nf-hpad" bgcolor="#0E121A" style="padding:26px 32px 28px;border-radius:20px 20px 0 0;background-color:#0E121A;background-image:radial-gradient(120% 90% at 50% 112%,{{skin.Glow}} 0%,rgba(0,0,0,0) 60%),linear-gradient(180deg,#07090E 0%,#151A24 100%)">
                          <img class="nf-art" src="{{Encode(art)}}" width="280" height="120" alt="" border="0" style="display:block;margin:0 auto 4px;border:0;outline:none;height:120px;width:280px;max-width:280px" />
                          <div style="font-family:{{FontStack}};font-size:27px;font-weight:700;letter-spacing:-0.6px;color:#ffffff;line-height:1.1">Notefusion</div>
                          <div style="font-family:{{FontStack}};font-size:13px;font-weight:500;color:{{skin.Line}};letter-spacing:0.3px;padding-top:7px">{{Encode(offer.Label)}} &nbsp;·&nbsp; {{(offer.LastCall ? "ends" : "until")}} {{Encode(until)}}</div>
                        </td>
                      </tr>

                      <tr>
                        <td class="nf-pad nf-body" bgcolor="{{Surface}}" style="padding:36px 40px 34px;background-color:{{Surface}};border-left:1px solid {{Border}};border-right:1px solid {{Border}}">
                          <h1 class="nf-h1 nf-ink" style="margin:0 0 18px;font-family:{{FontStack}};font-size:26px;font-weight:700;letter-spacing:-0.5px;color:{{Ink}};line-height:1.25">{{Encode(headline)}}</h1>{{countdown}}{{body}}
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 6px">
                            <tr>
                              <td class="nf-box" bgcolor="{{skin.BoxFill}}" style="padding:18px 22px 20px;background-color:{{skin.BoxFill}};border:1px solid {{skin.BoxBorder}};border-radius:14px">
                                <div class="nf-tag" style="font-family:{{FontStack}};font-size:12px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:{{skin.Tag}};padding-bottom:12px">{{Encode(offer.Label)}} &nbsp;·&nbsp; {{pct}}% off Pro</div>
                                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">{{rows}}
                                </table>
                              </td>
                            </tr>
                          </table>
                          <p class="nf-ink" style="margin:22px 0 2px;font-family:{{FontStack}};font-size:15px;font-weight:600;color:{{Ink}}">What Pro gives you</p>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px">{{ticks}}
                          </table>
                          <!-- Bulletproof button: the padded cell is what makes this render in Outlook. -->
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 14px">
                            <tr>
                              <td align="center" bgcolor="{{Blue}}" style="border-radius:999px">
                                <a href="{{Encode(offer.OfferUrl)}}" style="display:inline-block;padding:16px 34px;font-family:{{FontStack}};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;background:{{Blue}};background-image:linear-gradient(135deg,{{BlueDeep}} 0%,{{Blue}} 100%)">{{Encode(button)}}</a>
                              </td>
                            </tr>
                          </table>
                          <p class="nf-copy" style="margin:0;font-family:{{FontStack}};font-size:14px;line-height:1.6;color:{{Muted}}">{{Encode(endLine)}}</p>
                        </td>
                      </tr>

                      <tr>
                        <td class="nf-pad nf-foot" bgcolor="{{SurfaceAlt}}" style="padding:24px 40px 28px;background-color:{{SurfaceAlt}};border:1px solid {{Border}};border-radius:0 0 20px 20px">
                          <p class="nf-muted" style="margin:0 0 8px;font-family:{{FontStack}};font-size:13px;line-height:1.6;color:{{Muted}}">
                            You're getting this because you have a NoteFusion account and email from us is switched on. Questions? Reply to this email or write to
                            <a class="nf-link" href="mailto:{{Encode(_settings.SupportEmail)}}" style="color:{{Blue}};text-decoration:underline">{{Encode(_settings.SupportEmail)}}</a>.
                          </p>
                          <p class="nf-faint" style="margin:0;font-family:{{FontStack}};font-size:12px;line-height:1.6;color:{{Faint}}">
                            <a class="nf-faint" href="{{Encode(_settings.AppUrl)}}" style="color:{{Faint}};text-decoration:underline">{{Encode(site)}}</a>
                            &nbsp;·&nbsp; Tonic Solfa and staff notation from any melody.
                          </p>
                          <p class="nf-faint" style="margin:8px 0 0;font-family:{{FontStack}};font-size:12px;line-height:1.6;color:{{Faint}}">
                            Don't want emails like this? <a class="nf-faint" href="{{Encode(offer.UnsubscribeUrl)}}" style="color:{{Faint}};text-decoration:underline">Unsubscribe</a>.
                          </p>
                          <p class="nf-faint" style="margin:8px 0 0;font-family:{{FontStack}};font-size:12px;line-height:1.6;color:{{Faint}}">
                            NoteFusion &nbsp;·&nbsp; {{Encode(address)}}
                          </p>
                        </td>
                      </tr>

                    </table>
                  </td>
                </tr>
              </table>
              {{pixel}}
            </body>
            </html>
            """;

        var text = new List<string> { headerLine, "", headline, "" };
        if (offer.LastCall)
            text.AddRange([$"Ends at midnight on {endsOn}, your time.", ""]);
        text.AddRange([greeting, ""]);
        foreach (var paragraph in paragraphs)
            text.AddRange([paragraph, ""]);
        text.Add($"{offer.Label.ToUpperInvariant()} · {pct}% OFF PRO");
        foreach (var price in offer.Prices)
        {
            text.Add(price.Interval == BillingInterval.Yearly
                ? $"{price.Name}: {Usd(price.OfferAmountMinor)} for one year (was {Usd(price.AmountMinor)}), {Usd(PerMonth(price.OfferAmountMinor))} a month"
                : $"{price.Name}: {Usd(price.OfferAmountMinor)} for one month (was {Usd(price.AmountMinor)})");
        }
        text.AddRange(
        [
            "",
            "What Pro gives you",
            "- Whole songs up to six minutes, twenty a month",
            "- Alto, tenor and bass under any tune, and Learn my part to rehearse yours",
            "- Sing it back: every note of your part, marked",
            "- The fast lane: your songs never wait in a queue",
            "",
            $"{button}: {offer.OfferUrl}",
            "",
            endLine,
            "",
            "—",
            $"You're getting this because you have a NoteFusion account and email from us is switched on. Questions? Reply to this email or write to {_settings.SupportEmail}.",
            _settings.AppUrl,
            $"Don't want emails like this? Unsubscribe: {offer.UnsubscribeUrl}",
            $"NoteFusion · {address}",
        ]);

        return new RenderedOfferEmail(subject, preheader, html, string.Join("\n", text));
    }

    /// <summary>The season's header art (<c>web-site/email/season-{template}.png</c>, 560×240 shown 280×120), from the email assets' origin.</summary>
    private string SeasonArtUrl(string template)
    {
        var origin = _settings.AssetBaseUrl?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(origin) || origin.Contains("herokuapp.com", StringComparison.OrdinalIgnoreCase))
            origin = "https://notefusion.studio";
        var skin = template == OfferTemplates.Christmas ? OfferTemplates.Christmas : OfferTemplates.Halloween;
        return $"{origin}/email/season-{skin}.png";
    }

    /// <summary>A yearly price's month: a twelfth, to the cent.</summary>
    private static long PerMonth(long yearlyMinor) => (long)Math.Round(yearlyMinor / 12m, MidpointRounding.AwayFromZero);

    /// <summary>Dollars as the site writes them: "$6.99", and a whole price without cents ("$55").</summary>
    private static string Usd(long minor)
        => minor % 100 == 0
            ? "$" + (minor / 100).ToString("#,0", CultureInfo.InvariantCulture)
            : "$" + (minor / 100m).ToString("#,0.00", CultureInfo.InvariantCulture);
}
