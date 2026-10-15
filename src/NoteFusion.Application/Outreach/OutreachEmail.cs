using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Outreach;

/// <summary>
/// The facts one outreach email states. The copy itself lives with the email template, like every other
/// email's; this names which message and what to fill in.
/// </summary>
/// <param name="FounderName">Who it is from and signed by.</param>
/// <param name="ReplyTo">The founder's address; replies land there.</param>
/// <param name="UnsubscribeUrl">The account's one-click unsubscribe link.</param>
/// <param name="TriedOnUtc">For <see cref="OutreachSegment.TriedOnce"/>: when they transcribed.</param>
public sealed record OutreachEmail(
    OutreachSegment Segment,
    string FounderName,
    string ReplyTo,
    string UnsubscribeUrl,
    DateTime? TriedOnUtc = null);
