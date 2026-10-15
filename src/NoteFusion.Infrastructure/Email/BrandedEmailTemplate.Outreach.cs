using System.Globalization;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Outreach;
using NoteFusion.Core.Enums;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// The founder's customer-research notes (<see cref="OutreachEmail"/>). Written as a person writes, in the
/// first person and signed with the configured name, sent as "{founder} from NoteFusion" with replies going
/// to the founder. Each carries a one-click unsubscribe link in the footer and the List-Unsubscribe headers
/// mail providers expect on anything that is not transactional.
/// </summary>
public sealed partial class BrandedEmailTemplate
{
    /// <summary>West Africa Time, fixed (no daylight saving), for the "you tried it on" date.</summary>
    private static readonly TimeSpan OutreachOffset = TimeSpan.FromHours(1);

    public EmailMessage Outreach(EmailRecipient to, OutreachEmail email)
    {
        var first = FirstName(to) ?? "there";
        var founder = email.FounderName.Trim();
        var appUrl = _settings.AppUrl.TrimEnd('/') + "/app";

        var (subject, heading, preheader, lines, cta) = email.Segment switch
        {
            OutreachSegment.CheckoutAbandoned => (
                "What stopped you from getting Pro?",
                "A quick question",
                "Was it the price, the payment method, or something else?",
                new[]
                {
                    $"This is {founder}, I built NoteFusion. I saw you were about to get Pro the other day but didn't finish — completely fine.",
                    "Could you tell me what stopped you? Was it the price, the payment method, or something else?",
                    "Just reply to this email — your answer will directly change what I fix next, and I'll give you a month of Pro free as thanks.",
                },
                (CallToAction?)null),
            OutreachSegment.ActiveUser => (
                "10 minutes to make NoteFusion better?",
                "Thank you for using NoteFusion",
                "I'd love to hear what you use it for.",
                new[]
                {
                    $"{founder} here from NoteFusion. You're one of our most active users — thank you!",
                    "I'd love 10 minutes on WhatsApp to hear what you use it for and what would make it better. As a thank-you I'll give you a free month of Pro.",
                    "Just reply with a time that suits you this week.",
                },
                null),
            OutreachSegment.TriedOnce => (
                "Did your sheet come out right?",
                "Did your sheet come out right?",
                "Even a one-line reply helps a lot.",
                new[]
                {
                    $"{founder} from NoteFusion. You tried NoteFusion {TriedOn(email.TriedOnUtc)}. Did the sheet come out the way you hoped?",
                    "Even a one-line reply helps a lot (“it was wrong”, “I only needed one song”, “too expensive”…).",
                    "If you reply, I'll add a free month of Pro to your account.",
                },
                null),
            _ => (
                "Was something in the way?",
                "Can I help with your first song?",
                "Tell me the song you were hoping to write out.",
                new[]
                {
                    $"{founder} from NoteFusion. You signed up but haven't transcribed anything yet — was something in the way?",
                    "Reply and tell me what song you were hoping to write out, and I'll help you get it done.",
                },
                new CallToAction("Open NoteFusion", appUrl)),
        };

        var greeting = $"Hi {first},";
        var html = Paragraphs([Encode(greeting), .. lines.Select(Encode), $"Thanks,<br>{Encode(founder)}<br>NoteFusion"]);
        var text = Text(
            [
                greeting, "",
                .. lines.SelectMany(l => new[] { l, "" }),
                "Thanks,", founder, "NoteFusion",
                .. cta is null ? Array.Empty<string>() : ["", $"{cta.Label}: {cta.Url}"],
                "", $"Don't want emails like this? Unsubscribe: {email.UnsubscribeUrl}",
            ]);

        return new EmailMessage(
            to.Email,
            to.Name,
            subject,
            Layout(subject, preheader, heading, html, cta, email.UnsubscribeUrl),
            Footer(text),
            ReplyTo: email.ReplyTo,
            FromName: $"{founder} from NoteFusion",
            Headers: new Dictionary<string, string>
            {
                ["List-Unsubscribe"] = $"<{email.UnsubscribeUrl}>",
                ["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click",
            });
    }

    private static string TriedOn(DateTime? utc)
        => utc is { } at
            ? "on " + (at + OutreachOffset).ToString("d MMMM", CultureInfo.InvariantCulture)
            : "a little while ago";

    /// <summary>The footer's unsubscribe line, for the emails that carry one; empty otherwise.</summary>
    private static string UnsubscribeLine(string? url) => url is null
        ? string.Empty
        : $"""

                          <p style="margin:8px 0 0;font-family:{FontStack};font-size:12px;line-height:1.6;color:{Faint}">
                            Don't want emails like this? <a href="{Encode(url)}" style="color:{Faint};text-decoration:underline">Unsubscribe</a>.
                          </p>
          """;
}
