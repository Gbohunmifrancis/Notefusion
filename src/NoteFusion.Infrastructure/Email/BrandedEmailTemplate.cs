using System.Globalization;
using System.Net;
using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Email;

/// <summary>
/// Renders every transactional email in one NoteFusion-branded shell, so mail from the app is
/// recognisably the same product as the app itself. Tokens are copied from the design system —
/// <c>mobile/src/design/theme.ts</c> and <c>web-admin/src/app/globals.css</c> — not reinterpreted.
/// </summary>
/// <remarks>
/// <para>
/// Email HTML is not web HTML. The rules this file follows, each because a real client breaks
/// otherwise: tables for layout (Outlook has no flexbox or grid), every style inline or in a
/// <c>&lt;style&gt;</c> block that clients may drop, no external stylesheet, a solid
/// <c>bgcolor</c> under every gradient (Outlook renders the fallback), and a bulletproof
/// table-cell button rather than a styled <c>&lt;a&gt;</c> alone.
/// </para>
/// <para>
/// Poppins is requested but never assumed: clients that ignore web fonts fall through to the
/// system stack, which is why sizes and weights carry the brand rather than the typeface alone.
/// Everything interpolated is HTML-encoded — a display name arrives from Google or a sign-up form
/// and is not ours to trust.
/// </para>
/// </remarks>
public sealed class BrandedEmailTemplate
{
    // ── Design tokens ────────────────────────────────────────────────────────────
    private const string Blue = "#2563eb";
    private const string BlueDeep = "#1d4ed8";
    private const string Ink = "#0f172a";
    private const string Muted = "#5d6d82";
    private const string Faint = "#94a3b8";
    private const string Canvas = "#f4f7fc";
    private const string Surface = "#ffffff";
    private const string Border = "#e2e8f0";
    private const string SurfaceAlt = "#eef3fb";
    private const string Danger = "#dc2626";

    private const string FontStack =
        "'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    private readonly EmailSettings _settings;

    public BrandedEmailTemplate(EmailSettings settings) => _settings = settings;

    public EmailMessage Welcome(EmailRecipient to)
    {
        var name = FirstName(to);
        var body = Paragraphs(
            $"You're in{(name is null ? "" : $", {Encode(name)}")} — welcome to NoteFusion.",
            "Play or upload anything with a melody and you'll get it back as <strong>Tonic Solfa</strong> "
                + "and <strong>staff notation</strong>, in whatever key you need. Change the key and the "
                + "labels move with it; the notes never have to be re-recorded.",
            "Start with something short — a hymn line, a riff, a voice memo. Fifteen seconds is plenty.");

        return Compose(
            to,
            subject: "Welcome to NoteFusion",
            preheader: "Hear it. See it. Notate it.",
            heading: "Welcome to NoteFusion",
            bodyHtml: body,
            cta: new CallToAction("Open NoteFusion", _settings.AppUrl),
            textBody: Text(
                $"Welcome to NoteFusion{(name is null ? "" : $", {name}")}.",
                "",
                "Play or upload anything with a melody and you'll get it back as Tonic Solfa and staff",
                "notation, in whatever key you need. Change the key and the labels move with it; the notes",
                "never have to be re-recorded.",
                "",
                "Start with something short — a hymn line, a riff, a voice memo. Fifteen seconds is plenty.",
                "",
                _settings.AppUrl));
    }

    public EmailMessage PasswordChanged(EmailRecipient to)
    {
        var body = Paragraphs(
            "The password on your NoteFusion account was just changed.",
            "If that was you, nothing more to do — this note is only so a change can never happen quietly.")
            + Callout(
                "If it wasn't you, reset your password now and contact us at "
                    + $"<a href=\"mailto:{Encode(_settings.SupportEmail)}\" style=\"color:{Blue};"
                    + $"text-decoration:underline\">{Encode(_settings.SupportEmail)}</a>. "
                    + "Signing in again on every device is expected: the change signs the old sessions out.",
                Danger);

        return Compose(
            to,
            subject: "Your NoteFusion password was changed",
            preheader: "If this wasn't you, act now.",
            heading: "Password changed",
            bodyHtml: body,
            cta: null,
            textBody: Text(
                "The password on your NoteFusion account was just changed.",
                "",
                "If that was you, nothing more to do — this note is only so a change can never happen quietly.",
                "",
                $"If it wasn't you, reset your password now and contact us at {_settings.SupportEmail}.",
                "Signing in again on every device is expected: the change signs the old sessions out."));
    }

    public EmailMessage PasswordReset(EmailRecipient to, string resetUrl)
    {
        var name = FirstName(to);
        var greeting = name is null ? "Hi there," : $"Hi {Encode(name)},";
        var body = Paragraphs(greeting,
            "We received a request to reset your NoteFusion password. Click the button below — "
                + "this link expires in <strong>1 hour</strong>. If you didn't ask for this, you can safely ignore the email.")
            + Callout(
                "For your security, this link can only be used once and expires in 60 minutes.",
                Blue);

        return Compose(
            to,
            subject: "Reset your NoteFusion password",
            preheader: "Use this link to reset your password. It expires in 1 hour.",
            heading: "Reset your password",
            bodyHtml: body,
            cta: new CallToAction("Reset password", resetUrl),
            textBody: Text(
                greeting,
                "",
                "We received a request to reset your NoteFusion password.",
                "Use the link below (expires in 1 hour):",
                "",
                resetUrl,
                "",
                "If you didn't request this, ignore this email."));
    }

    public EmailMessage VerifyEmail(EmailRecipient to, string code)
    {
        var name = FirstName(to);
        var greeting = name is null ? "Almost there —" : $"Almost there, {Encode(name)} —";
        var body = Paragraphs(
            $"{greeting} enter this code in the app to confirm this is your email address and finish "
                + "setting up your account.")
            + CodeBlock(code)
            + Paragraphs(
                "The code expires in <strong>10 minutes</strong>. If it does, ask for a new one from the "
                    + "same screen.")
            + Callout(
                "If you didn't sign up for NoteFusion, ignore this email — the account isn't active and "
                    + "nobody can sign into it without this code.",
                Blue);

        return Compose(
            to,
            // Some clients preview the subject only, so the code goes in it: one glance from the
            // notification shade is enough to type it, without opening the mail at all.
            subject: $"{code} is your NoteFusion verification code",
            preheader: "Enter this code to confirm your email address. It expires in 10 minutes.",
            heading: "Confirm your email",
            bodyHtml: body,
            // No button on purpose. A link that verifies would have to carry the code, and a code that
            // travels in a URL is a code that ends up in a browser history and a referrer header.
            cta: null,
            textBody: Text(
                $"{(name is null ? "Almost there" : $"Almost there, {name}")} — enter this code in the app to confirm",
                "your email address and finish setting up your account.",
                "",
                $"    {code}",
                "",
                "The code expires in 10 minutes. If it does, ask for a new one from the same screen.",
                "",
                "If you didn't sign up for NoteFusion, ignore this email — the account isn't active",
                "and nobody can sign into it without this code."));
    }

    public EmailMessage SubscriptionReceipt(EmailRecipient to, SubscriptionReceipt receipt)
    {
        var amount = FormatAmount(receipt.AmountMinor, receipt.Currency);

        // A one-off purchase has no next charge, so every line that would name one says so instead. The
        // two shapes are built together rather than in separate methods because they are the same
        // receipt — only the renewal fact differs.
        var renews = receipt.RenewsAtUtc?.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
        var renewsLabel = renews is null ? "Access" : "Renews on";
        var renewsValue = renews ?? "Lifetime — never expires";
        var closing = renews is null
            ? "Keep this email as your receipt. Pro is yours for good — there is nothing to renew and "
                + "nothing to cancel."
            : "Keep this email as your receipt. You can cancel any time from Account settings; "
                + "Pro stays on until the date above.";

        var body = Paragraphs(
            "Payment received — your NoteFusion Pro subscription is active.")
            + FactTable(
                ("Plan", Encode(receipt.PlanName)),
                ("Amount paid", Encode(amount)),
                (renewsLabel, Encode(renewsValue)),
                ("Reference", $"<span style=\"font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace\">{Encode(receipt.Reference)}</span>"))
            + Paragraphs(closing);

        return Compose(
            to,
            subject: $"Your NoteFusion receipt — {amount}",
            preheader: renews is null
                ? $"{receipt.PlanName} is active for life."
                : $"{receipt.PlanName} is active until {renews}.",
            heading: "You're on Pro",
            bodyHtml: body,
            cta: new CallToAction("Open NoteFusion", _settings.AppUrl),
            textBody: Text(
                "Payment received — your NoteFusion Pro subscription is active.",
                "",
                $"Plan:        {receipt.PlanName}",
                $"Amount paid: {amount}",
                $"{renewsLabel + ':',-13}{renewsValue}",
                $"Reference:   {receipt.Reference}",
                "",
                renews is null
                    ? "Keep this email as your receipt. Pro is yours for good — there is nothing to renew"
                    : "Keep this email as your receipt. You can cancel any time from Account settings;",
                renews is null
                    ? "and nothing to cancel."
                    : "Pro stays on until the date above."));
    }

    public EmailMessage PaymentFailed(EmailRecipient to, string planName)
    {
        var body = Paragraphs(
            $"Your payment for <strong>{Encode(planName)}</strong> didn't go through, so the upgrade "
                + "hasn't started.",
            "Nothing was charged. Your account is untouched and everything you've already transcribed "
                + "is still there.")
            + Callout(
                "Card declines are usually a bank block on online or international payments — worth a "
                    + "retry, or try another card.",
                Blue);

        return Compose(
            to,
            subject: "Your NoteFusion payment didn't go through",
            preheader: "Nothing was charged. You can try again.",
            heading: "Payment didn't go through",
            bodyHtml: body,
            cta: new CallToAction("Try again", _settings.AppUrl),
            textBody: Text(
                $"Your payment for {planName} didn't go through, so the upgrade hasn't started.",
                "",
                "Nothing was charged. Your account is untouched and everything you've already",
                "transcribed is still there.",
                "",
                "Card declines are usually a bank block on online or international payments — worth a",
                "retry, or try another card.",
                "",
                _settings.AppUrl));
    }

    public EmailMessage SubscriptionExpiring(EmailRecipient to, SubscriptionExpiry expiry)
    {
        var ends = expiry.ExpiresAtUtc.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
        var window = expiry.DaysLeft == 1 ? "tomorrow" : $"in {expiry.DaysLeft} days";

        // The one line that must not be wrong. An active subscription is about to take money; a
        // cancelled one is about to stop working. Same date, opposite thing to do about it.
        var (lead, callout, cta, textLead, textCallout) = expiry.WillRenew
            ? ($"Your <strong>{Encode(expiry.PlanName)}</strong> subscription renews {window}.",
               "Nothing to do — we'll charge the card on file and Pro carries straight on. Cancel from "
                   + "Account settings if you'd rather it didn't.",
               "Manage subscription",
               $"Your {expiry.PlanName} subscription renews {window}.",
               "Nothing to do — we'll charge the card on file and Pro carries straight on. Cancel from")
            : ($"Your <strong>{Encode(expiry.PlanName)}</strong> subscription ends {window}.",
               "It won't renew, so Pro features switch off on that date. Resubscribe any time to pick "
                   + "up where you left off.",
               "Resubscribe",
               $"Your {expiry.PlanName} subscription ends {window}.",
               "It won't renew, so Pro features switch off on that date. Resubscribe any time to");

        var body = Paragraphs(lead)
            + FactTable(
                ("Plan", Encode(expiry.PlanName)),
                (expiry.WillRenew ? "Renews on" : "Ends on", Encode(ends)))
            + Callout(callout, expiry.WillRenew ? Blue : Danger)
            + Paragraphs(
                "Everything you've transcribed stays in your library either way — it's yours, not the "
                    + "subscription's.");

        return Compose(
            to,
            subject: expiry.WillRenew
                ? $"Your NoteFusion Pro renews {window}"
                : $"Your NoteFusion Pro ends {window}",
            preheader: $"{expiry.PlanName} — {(expiry.WillRenew ? "renews" : "ends")} {ends}.",
            heading: expiry.WillRenew ? "Renewing soon" : "Ending soon",
            bodyHtml: body,
            cta: new CallToAction(cta, _settings.AppUrl),
            textBody: Text(
                textLead,
                "",
                $"Plan:    {expiry.PlanName}",
                $"{(expiry.WillRenew ? "Renews on" : "Ends on")}: {ends}",
                "",
                textCallout,
                expiry.WillRenew
                    ? "Account settings if you'd rather it didn't."
                    : "pick up where you left off.",
                "",
                "Everything you've transcribed stays in your library either way — it's yours, not",
                "the subscription's.",
                "",
                _settings.AppUrl));
    }

    /// <summary>
    /// Renders a custom admin message inside NoteFusion's branded email shell.
    /// </summary>
    public EmailMessage Custom(
        EmailRecipient to,
        string subject,
        string heading,
        string bodyHtml,
        string? ctaText = null,
        string? ctaUrl = null)
    {
        var name = FirstName(to);
        CallToAction? cta = !string.IsNullOrWhiteSpace(ctaText) && !string.IsNullOrWhiteSpace(ctaUrl)
            ? new CallToAction(ctaText, ctaUrl)
            : null;

        var formattedBody = bodyHtml.Contains("<p", StringComparison.OrdinalIgnoreCase) ||
                            bodyHtml.Contains("<div", StringComparison.OrdinalIgnoreCase) ||
                            bodyHtml.Contains("<table", StringComparison.OrdinalIgnoreCase)
            ? bodyHtml
            : Paragraphs(bodyHtml.Split(new[] { "\r\n\r\n", "\n\n" }, StringSplitOptions.RemoveEmptyEntries));

        return Compose(
            to,
            subject: subject,
            preheader: heading,
            heading: heading,
            bodyHtml: formattedBody,
            cta: cta,
            textBody: Text(
                $"Hello{(name is null ? "" : $" {name}")},",
                "",
                bodyHtml.Replace("<br>", "\n").Replace("<br/>", "\n").Replace("<p>", "").Replace("</p>", "\n\n"),
                cta is not null ? $"\n{cta.Label}: {cta.Url}" : ""));
    }

    // ── Shell ────────────────────────────────────────────────────────────────────

    private sealed record CallToAction(string Label, string Url);

    private EmailMessage Compose(
        EmailRecipient to,
        string subject,
        string preheader,
        string heading,
        string bodyHtml,
        CallToAction? cta,
        string textBody)
        => new(to.Email, to.Name, subject, Layout(subject, preheader, heading, bodyHtml, cta), Footer(textBody));

    private string Layout(string title, string preheader, string heading, string bodyHtml, CallToAction? cta)
    {
        var logo = LogoUrl();
        // Images off is the default in plenty of clients, so the wordmark is live text either way and
        // the mark is an enhancement rather than the header itself.
        var mark = logo is null
            ? string.Empty
            : $"""
               <img src="{Encode(logo)}" width="46" height="61" alt="NoteFusion"
                    border="0" style="display:block;margin:0 auto 14px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;height:61px;width:46px;max-width:46px" />
               """;

        var button = cta is null
            ? string.Empty
            : $"""
                             <!-- Bulletproof button: the padded cell is what makes this render in Outlook. -->
                             <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 6px">
                               <tr>
                                 <td align="center" bgcolor="{Blue}" style="border-radius:999px">
                                   <a href="{Encode(cta.Url)}"
                                      style="display:inline-block;padding:16px 34px;font-family:{FontStack};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;background:{Blue};background-image:linear-gradient(135deg,{BlueDeep} 0%,{Blue} 100%)">{Encode(cta.Label)}</a>
                                 </td>
                               </tr>
                             </table>
               """;

        // Footer link label tracks AppUrl (scheme stripped) so it can't drift from the href.
        var site = _settings.AppUrl.Replace("https://", string.Empty).Replace("http://", string.Empty).TrimEnd('/');

        return $$"""
            <!DOCTYPE html>
            <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
            <head>
              <meta charset="utf-8" />
              <meta name="viewport" content="width=device-width,initial-scale=1" />
              <meta name="x-apple-disable-message-reformatting" />
              <title>{{Encode(title)}}</title>
              <style>
                @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
                /* Declared so dark-mode clients tint rather than invert; the explicit backgrounds
                   below are what stop text from turning unreadable when they do. */
                :root { color-scheme: light dark; supported-color-schemes: light dark; }
                a { color: {{Blue}}; }
                @media only screen and (max-width:620px) {
                  .nf-shell { width: 100% !important; }
                  .nf-pad { padding-left: 24px !important; padding-right: 24px !important; }
                  .nf-h1 { font-size: 24px !important; }
                }
              </style>
            </head>
            <body style="margin:0;padding:0;background-color:{{Canvas}};font-family:{{FontStack}};-webkit-font-smoothing:antialiased">
              <!-- Preheader: the line clients show next to the subject. Hidden in the body, and padded
                   with zero-width joiners so the message text isn't dragged into the preview. -->
              <div style="display:none;font-size:1px;color:{{Canvas}};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">{{Encode(preheader)}}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="{{Canvas}}" style="background-color:{{Canvas}}">
                <tr>
                  <td align="center" style="padding:32px 12px">

                    <table role="presentation" class="nf-shell" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px">

                      <!-- Brand header. The gradient is progressive: Outlook keeps the bgcolor. -->
                      <tr>
                        <td align="center" bgcolor="{{Blue}}"
                            style="padding:36px 32px 30px;border-radius:20px 20px 0 0;background:{{Blue}};background-image:linear-gradient(135deg,{{BlueDeep}} 0%,{{Blue}} 100%)">
                          {{mark}}
                          <div style="font-family:{{FontStack}};font-size:27px;font-weight:700;letter-spacing:-0.6px;color:#ffffff;line-height:1.1">Notefusion</div>
                          <div style="font-family:{{FontStack}};font-size:13px;font-weight:500;color:#dbeafe;letter-spacing:0.2px;padding-top:5px">Hear it. See it. Notate it.</div>
                        </td>
                      </tr>

                      <!-- Body -->
                      <tr>
                        <td class="nf-pad" bgcolor="{{Surface}}"
                            style="padding:38px 40px 34px;background-color:{{Surface}};border-left:1px solid {{Border}};border-right:1px solid {{Border}}">
                          <h1 class="nf-h1" style="margin:0 0 18px;font-family:{{FontStack}};font-size:26px;font-weight:700;letter-spacing:-0.5px;color:{{Ink}};line-height:1.25">{{Encode(heading)}}</h1>
                          {{bodyHtml}}
                          {{button}}
                        </td>
                      </tr>

                      <!-- Footer -->
                      <tr>
                        <td class="nf-pad" bgcolor="{{SurfaceAlt}}"
                            style="padding:24px 40px 28px;background-color:{{SurfaceAlt}};border:1px solid {{Border}};border-radius:0 0 20px 20px">
                          <p style="margin:0 0 8px;font-family:{{FontStack}};font-size:13px;line-height:1.6;color:{{Muted}}">
                            Sent by NoteFusion because of activity on your account. Questions? Reply to this email or write to
                            <a href="mailto:{{Encode(_settings.SupportEmail)}}" style="color:{{Blue}};text-decoration:underline">{{Encode(_settings.SupportEmail)}}</a>.
                          </p>
                          <p style="margin:0;font-family:{{FontStack}};font-size:12px;line-height:1.6;color:{{Faint}}">
                            <a href="{{Encode(_settings.AppUrl)}}" style="color:{{Faint}};text-decoration:underline">{{Encode(site)}}</a>
                            &nbsp;·&nbsp; Tonic Solfa and staff notation from any melody.
                          </p>
                        </td>
                      </tr>

                    </table>

                  </td>
                </tr>
              </table>
            </body>
            </html>
            """;
    }

    /// <summary>The same sign-off as the HTML footer, so the two parts read as one message.</summary>
    private string Footer(string textBody) => $"""
        {textBody}

        —
        NoteFusion · Hear it. See it. Notate it.
        {_settings.AppUrl}
        Questions? {_settings.SupportEmail}
        """;

    // ── Body blocks ──────────────────────────────────────────────────────────────

    /// <summary>Body copy. Already-safe HTML by contract — callers encode anything they interpolate.</summary>
    private static string Paragraphs(params string[] html) => string.Concat(html.Select(p =>
        $"""
        <p style="margin:0 0 14px;font-family:{FontStack};font-size:16px;line-height:1.65;color:{Muted}">{p}</p>
        """));

    /// <summary>A tinted aside for the one line in the email that must not be skimmed past.</summary>
    private static string Callout(string html, string accent) => $"""
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 4px">
          <tr>
            <td style="padding:14px 18px;background-color:{SurfaceAlt};border-left:3px solid {accent};border-radius:0 8px 8px 0;font-family:{FontStack};font-size:14px;line-height:1.6;color:{Ink}">{html}</td>
          </tr>
        </table>
        """;

    /// <summary>
    /// A one-time code, set large and spaced so it can be read off a screen and typed into a phone
    /// without a second look. Monospaced because 0/O and 1/l are the whole risk in a code you retype;
    /// letter-spaced because digits run together at this size.
    /// </summary>
    /// <remarks>
    /// Not selectable-text-in-a-button and not a link: the code is the secret, so it stays something the
    /// reader copies deliberately. <c>user-select:all</c> makes one tap grab the whole thing on clients
    /// that honour it, and costs nothing on those that don't.
    /// </remarks>
    private static string CodeBlock(string code) => $"""
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 8px">
          <tr>
            <td align="center" bgcolor="{SurfaceAlt}"
                style="padding:22px 18px;background-color:{SurfaceAlt};border:1px solid {Border};border-radius:14px">
              <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:10px;line-height:1.2;color:{Blue};-webkit-user-select:all;user-select:all">{Encode(code)}</div>
              <div style="font-family:{FontStack};font-size:12px;font-weight:500;letter-spacing:0.4px;color:{Faint};padding-top:10px;text-transform:uppercase">Verification code</div>
            </td>
          </tr>
        </table>
        """;

    /// <summary>Label/value rows — the receipt's facts, where alignment is the whole point.</summary>
    private static string FactTable(params (string Label, string Value)[] rows)
    {
        var cells = string.Concat(rows.Select((r, i) => $"""
            <tr>
              <td style="padding:{(i == 0 ? "0" : "10px")} 0 0;font-family:{FontStack};font-size:14px;color:{Muted};white-space:nowrap">{Encode(r.Label)}</td>
              <td align="right" style="padding:{(i == 0 ? "0" : "10px")} 0 0;font-family:{FontStack};font-size:15px;font-weight:600;color:{Ink}">{r.Value}</td>
            </tr>
            """));

        return $"""
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 6px">
              <tr>
                <td style="padding:20px 22px;background-color:{SurfaceAlt};border:1px solid {Border};border-radius:14px">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">{cells}</table>
                </td>
              </tr>
            </table>
            """;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private string LogoUrl()
    {
        var origin = _settings.AssetBaseUrl?.TrimEnd('/');
        return string.IsNullOrWhiteSpace(origin) || origin.Contains("herokuapp.com", StringComparison.OrdinalIgnoreCase)
            ? "https://notefusion.studio/email/logo.png"
            : $"{origin}/email/logo.png";
    }

    private static string Text(params string[] lines) => string.Join("\n", lines);

    private static string Encode(string value) => WebUtility.HtmlEncode(value);

    /// <summary>First name only — a greeting, not a form field. Null when there is nothing usable.</summary>
    private static string? FirstName(EmailRecipient to)
    {
        var name = to.Name?.Trim();
        if (string.IsNullOrEmpty(name)) return null;

        // Google accounts without a name fall back to the email address, which reads badly as a
        // greeting ("You're in, ada@example.com").
        if (name.Contains('@')) return null;

        return name.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
    }

    /// <summary>Minor units to something a person reads. USD gets its symbol; anything else its code.</summary>
    private static string FormatAmount(long amountMinor, string currency)
    {
        var major = (amountMinor / 100m).ToString("N2", CultureInfo.InvariantCulture);
        var code = currency.ToUpperInvariant();
        return code == "USD" ? $"${major}" : $"{code} {major}";
    }
}
