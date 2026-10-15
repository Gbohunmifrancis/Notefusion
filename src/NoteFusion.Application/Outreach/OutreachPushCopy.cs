using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Outreach;

/// <summary>
/// The one-line push that goes with each outreach email. A tap opens the app: the plans for an unfinished
/// checkout, the record tab for someone who has not transcribed yet, and wherever they were otherwise
/// (the <c>screen</c> names are the mobile <c>notificationLink</c> allow-list).
/// </summary>
public static class OutreachPushCopy
{
    public static PushMessage For(OutreachSegment segment) => segment switch
    {
        OutreachSegment.CheckoutAbandoned => new PushMessage(
            "A quick question from NoteFusion",
            "What stopped you from getting Pro? Check your email 🙏",
            new Dictionary<string, string> { ["screen"] = "Upgrade" }),
        OutreachSegment.ActiveUser => new PushMessage(
            "Got 2 minutes?",
            "We'd love to hear how NoteFusion is going for you. Check your email."),
        OutreachSegment.TriedOnce => new PushMessage(
            "Did your sheet come out right?",
            "Tell us — it helps a lot. Check your email."),
        _ => new PushMessage(
            "Ready to try your first song?",
            "Sing or paste a link and NoteFusion writes it out.",
            new Dictionary<string, string> { ["screen"] = "Record" }),
    };
}
