using System.Globalization;
using System.Net;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Inbox.Sent;

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
public sealed partial class BrandedEmailTemplate
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

    public EmailMessage WaitlistConfirmation(EmailRecipient to)
    {
        var name = FirstName(to);
        var body = Paragraphs(
            $"You're on the list{(name is null ? "" : $", {Encode(name)}")}.",
            "Thank you for joining the NoteFusion waitlist! We're excited to have you with us.",
            "You will receive an invitation email with early access to start transcribing live and recorded melodies into <strong>Tonic Solfa</strong> and <strong>staff notation</strong>.",
            "In the meantime, feel free to explore our notation preview and updates at <a href=\"" + Encode(_settings.AppUrl) + "\" style=\"color:" + Blue + ";text-decoration:underline\">notefusion.studio</a>.")
            + Callout("Have questions or specific music team requirements? Reach our team anytime at "
                + $"<a href=\"mailto:{Encode(_settings.SupportEmail)}\" style=\"color:{Blue};text-decoration:underline\">{Encode(_settings.SupportEmail)}</a>.", Blue);

        return Compose(
            to,
            subject: "You're on the NoteFusion waitlist!",
            preheader: "We've reserved your spot for early access.",
            heading: "You're on the waitlist",
            bodyHtml: body,
            cta: new CallToAction("Visit NoteFusion", _settings.AppUrl),
            textBody: Text(
                $"You're on the NoteFusion waitlist{(name is null ? "" : $", {name}")}!",
                "",
                "Thank you for joining our waitlist! We're excited to have you with us.",
                "You'll receive an invitation with early access to start transcribing live and recorded music into Tonic Solfa and staff notation.",
                "",
                $"Visit us: {_settings.AppUrl}",
                $"Support: {_settings.SupportEmail}"));
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

    public EmailMessage AccountAlreadyExists(EmailRecipient to)
    {
        var name = FirstName(to);
        var greeting = name is null ? "Hi there," : $"Hi {Encode(name)},";
        var body = Paragraphs(greeting,
            "Someone just tried to create a NoteFusion account with this email address. You already have one, "
                + "so nothing was created and nothing about your account has changed.",
            "If that was you, sign in instead. If you have forgotten your password, use "
                + "<strong>Forgot password</strong> on the sign-in screen to choose a new one.")
            + Callout(
                "If it wasn't you, you can ignore this email — nobody can get into your account without your password.",
                Blue);

        return Compose(
            to,
            subject: "You already have a NoteFusion account",
            preheader: "Sign in, or reset your password if you have forgotten it.",
            heading: "You already have an account",
            bodyHtml: body,
            cta: new CallToAction("Sign in to NoteFusion", _settings.AppUrl),
            textBody: Text(
                greeting,
                "",
                "Someone just tried to create a NoteFusion account with this email address. You already have one, "
                    + "so nothing was created and nothing about your account has changed.",
                "",
                "If that was you, sign in instead. If you have forgotten your password, use Forgot password on "
                    + "the sign-in screen to choose a new one.",
                "",
                "If it wasn't you, you can ignore this email — nobody can get into your account without your password.",
                "",
                _settings.AppUrl));
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
            subject: SentMailPrivacy.PasswordResetSubject,
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
            subject: code + SentMailPrivacy.VerificationCodeSuffix,
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

    public EmailMessage AdminCode(EmailRecipient to, string code, bool setup)
    {
        var what = setup ? "set Admin up on a phone" : "open Admin on your phone";
        var body = Paragraphs(
            $"Enter this code in the NoteFusion app to {what}.")
            + CodeBlock(code)
            + Paragraphs("The code expires in <strong>10 minutes</strong> and works once.")
            + Callout(
                "If you didn't just ask for it, someone has your NoteFusion password. Change it now and contact us at "
                    + $"<a href=\"mailto:{Encode(_settings.SupportEmail)}\" style=\"color:{Blue};"
                    + $"text-decoration:underline\">{Encode(_settings.SupportEmail)}</a>.",
                Danger);

        return Compose(
            to,
            subject: code + SentMailPrivacy.AdminCodeSuffix,
            preheader: $"Enter it in the app to {what}. It expires in 10 minutes.",
            heading: setup ? "Set up Admin on a phone" : "Open Admin",
            bodyHtml: body,
            // No button: a code that travels in a link ends up in a browser history.
            cta: null,
            textBody: Text(
                $"Enter this code in the NoteFusion app to {what}:",
                "",
                $"    {code}",
                "",
                "The code expires in 10 minutes and works once.",
                "",
                "If you didn't just ask for it, someone has your NoteFusion password.",
                $"Change it now and contact us at {_settings.SupportEmail}."));
    }

    public EmailMessage AdminPhoneAdded(EmailRecipient to, string phoneLabel, DateTime atUtc)
    {
        var when = (atUtc + FreeTier.WestAfricaOffset)
            .ToString("ddd d MMM yyyy, HH:mm", CultureInfo.InvariantCulture) + " (West Africa Time)";
        var body = Paragraphs(
            "Admin was just set up on a phone. From now on that phone's fingerprint or face opens it.")
            + FactTable(("Phone", Encode(phoneLabel)), ("When", Encode(when)))
            + Callout(
                "If this wasn't you, someone has your password and your email. Change your password now and contact us at "
                    + $"<a href=\"mailto:{Encode(_settings.SupportEmail)}\" style=\"color:{Blue};"
                    + $"text-decoration:underline\">{Encode(_settings.SupportEmail)}</a>.",
                Danger);

        return Compose(
            to,
            subject: "Admin was set up on a phone",
            preheader: "If this wasn't you, act now.",
            heading: "A phone can open Admin",
            bodyHtml: body,
            cta: null,
            textBody: Text(
                "Admin was just set up on a phone. From now on that phone's fingerprint or face opens it.",
                "",
                $"Phone: {phoneLabel}",
                $"When: {when}",
                "",
                "If this wasn't you, someone has your password and your email.",
                $"Change your password now and contact us at {_settings.SupportEmail}."));
    }

    public EmailMessage AdminPasskeyAdded(EmailRecipient to, string passkeyName, DateTime atUtc)
    {
        var when = (atUtc + FreeTier.WestAfricaOffset)
            .ToString("ddd d MMM yyyy, HH:mm", CultureInfo.InvariantCulture) + " (West Africa Time)";
        var body = Paragraphs(
            "A passkey was just added to your admin account. From now on it signs in to the admin console without a password.")
            + FactTable(("Passkey", Encode(passkeyName)), ("When", Encode(when)))
            + Callout(
                "If this wasn't you, remove it under Settings › Passkeys in the console, change your password, and contact us at "
                    + $"<a href=\"mailto:{Encode(_settings.SupportEmail)}\" style=\"color:{Blue};"
                    + $"text-decoration:underline\">{Encode(_settings.SupportEmail)}</a>.",
                Danger);

        return Compose(
            to,
            subject: "A passkey was added to your admin account",
            preheader: "If this wasn't you, act now.",
            heading: "A new passkey can sign in",
            bodyHtml: body,
            cta: null,
            textBody: Text(
                "A passkey was just added to your admin account. From now on it signs in to the admin console without a password.",
                "",
                $"Passkey: {passkeyName}",
                $"When: {when}",
                "",
                "If this wasn't you, remove it under Settings > Passkeys in the console, change your password,",
                $"and contact us at {_settings.SupportEmail}."));
    }

    public EmailMessage SubscriptionReceipt(EmailRecipient to, SubscriptionReceipt receipt)
    {
        var amount = FormatAmount(receipt.AmountMinor, receipt.Currency);

        // One transcription bought, not Pro time: a different receipt with nothing about a membership.
        if (receipt.OneTranscription)
            return OneTranscriptionReceipt(to, receipt, amount);

        // A one-off purchase has no next charge, so every line that would name one says so instead. The
        // two shapes are built together rather than in separate methods because they are the same
        // receipt — only the renewal fact differs.
        var renews = receipt.RenewsAtUtc?.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
        var renewsLabel = renews is null ? "Access" : "Pro until";
        var renewsValue = renews ?? "Lifetime — never expires";
        var closing = renews is null
            ? "Keep this email as your receipt. Pro is yours for good — there is nothing to renew and "
                + "nothing to cancel."
            : "Keep this email as your receipt. Pro runs until the date above and nothing renews by itself; "
                + "add more time from the app whenever you like.";

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
                    : "Keep this email as your receipt. Pro runs until the date above and nothing renews by itself;",
                renews is null
                    ? "and nothing to cancel."
                    : "add more time from the app whenever you like."));
    }

    private EmailMessage OneTranscriptionReceipt(EmailRecipient to, SubscriptionReceipt receipt, string amount)
    {
        const string lead = "Payment received — one more transcription has been added to your NoteFusion account.";
        const string closing = "Use it on any recording or song link; it never expires. "
            + "Keep this email as your receipt. There is no subscription and nothing will be charged again.";

        var body = Paragraphs(lead)
            + FactTable(
                ("Bought", Encode(receipt.PlanName)),
                ("Amount paid", Encode(amount)),
                ("Reference", $"<span style=\"font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace\">{Encode(receipt.Reference)}</span>"))
            + Paragraphs(closing);

        return Compose(
            to,
            subject: $"Your NoteFusion receipt — {amount}",
            preheader: "One more transcription is ready to use.",
            heading: "Your song is paid for",
            bodyHtml: body,
            cta: new CallToAction("Open NoteFusion", _settings.AppUrl),
            textBody: Text(
                lead,
                "",
                $"Bought:      {receipt.PlanName}",
                $"Amount paid: {amount}",
                $"Reference:   {receipt.Reference}",
                "",
                "Use it on any recording or song link; it never expires.",
                "Keep this email as your receipt. There is no subscription and nothing will be charged again."));
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

    public EmailMessage CheckoutAbandoned(EmailRecipient to, string planName)
    {
        // Opens the plans in the web app; the account's own sign-in brings them straight back to it.
        var plansUrl = _settings.AppUrl.TrimEnd('/') + "/app?upgrade=1";
        var body = Paragraphs(
            $"You started checking out <strong>{Encode(planName)}</strong> but the payment didn't finish, "
                + "so nothing was charged.",
            "Pro gives you whole songs instead of the first minute, alto, tenor and bass under the tune, "
                + "and the PDF, MusicXML and MIDI downloads for your choir.")
            + Callout(
                "If something went wrong — a declined card, a bank block on online payments, a page that "
                    + "wouldn't load — write to <a href=\"mailto:hello@notefusion.studio\" style=\"color:" + Blue
                    + ";text-decoration:underline\">hello@notefusion.studio</a> and tell us. A person reads "
                    + "every message and will help you finish.",
                Blue);

        return Compose(
            to,
            subject: "Your NoteFusion Pro checkout didn't finish",
            preheader: "Nothing was charged. Pick up where you left off, or tell us what went wrong.",
            heading: "Still want Pro?",
            bodyHtml: body,
            cta: new CallToAction("Finish upgrading", plansUrl),
            textBody: Text(
                $"You started checking out {planName} but the payment didn't finish, so nothing was charged.",
                "",
                "Pro gives you whole songs instead of the first minute, alto, tenor and bass under the",
                "tune, and the PDF, MusicXML and MIDI downloads for your choir.",
                "",
                "If something went wrong (a declined card, a bank block on online payments, a page that",
                "wouldn't load), write to hello@notefusion.studio and tell us. A person reads every",
                "message and will help you finish.",
                "",
                "Finish upgrading: " + plansUrl));
    }

    public EmailMessage TranscriptionFailed(EmailRecipient to, bool onPro)
    {
        var appUrl = _settings.AppUrl.TrimEnd('/') + "/app";
        var cost = onPro
            ? "It didn't use anything from your Pro allowance."
            : "It didn't count against your free tries.";
        string[] tips =
        [
            "Record close to the voice or instrument, about an arm's length away, somewhere quiet.",
            "One voice or one instrument at a time. A band or a crowd blurs the notes together.",
            "Keep it under about two minutes. For a song, pick just the section you need.",
        ];
        var list = $"<ol style=\"margin:0 0 14px;padding-left:22px;font-family:{FontStack};font-size:16px;line-height:1.65;color:{Muted}\">"
            + string.Concat(tips.Select(t => $"<li style=\"margin:0 0 6px\">{Encode(t)}</li>"))
            + "</ol>";
        var body = Paragraphs(
                "Your last transcription couldn't be finished. " + Encode(cost),
                "Three things that make the next one work:")
            + list;

        return Compose(
            to,
            subject: "Your transcription didn't come through",
            preheader: cost + " Three tips for the next one.",
            heading: "Let's try that again",
            bodyHtml: body,
            cta: new CallToAction("Open NoteFusion", appUrl),
            textBody: Text(
                "Your last transcription couldn't be finished. " + cost,
                "",
                "Three things that make the next one work:",
                "1. " + tips[0],
                "2. " + tips[1],
                "3. " + tips[2],
                "",
                "Open NoteFusion: " + appUrl));
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
            : ($"Your <strong>{Encode(expiry.PlanName)}</strong> ends {window}.",
               "Nothing renews by itself, so Pro features switch off on that date unless you add more "
                   + "time. Add a month or a year from the app whenever you like; it starts when your current time ends.",
               "Add more Pro time",
               $"Your {expiry.PlanName} ends {window}.",
               "Nothing renews by itself, so Pro features switch off on that date unless you add more time. Add a month or a year from the app whenever you like;");

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
                    : "it starts when your current time ends.",
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

    private string Layout(
        string title, string preheader, string heading, string bodyHtml, CallToAction? cta, string? unsubscribeUrl = null)
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
                          </p>{{UnsubscribeLine(unsubscribeUrl)}}
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
