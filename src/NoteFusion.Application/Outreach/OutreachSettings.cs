namespace NoteFusion.Application.Outreach;

/// <summary>
/// The founder's customer-research outreach (section <c>Outreach</c>): <c>Outreach__Enabled</c>,
/// <c>Outreach__FounderName</c>, <c>Outreach__ReplyTo</c>, <c>Outreach__BatchSize</c>,
/// <c>Outreach__IntervalMinutes</c>, <c>Outreach__ApiBaseUrl</c>. Off unless all three of Enabled, a
/// founder name and a reply-to address are set, so dev, tests and a half-configured deploy send nothing.
/// </summary>
public sealed class OutreachSettings
{
    public const string DefaultApiBaseUrl = "https://api.notefusion.studio";

    public bool Enabled { get; init; }

    /// <summary>Who the emails are from and signed by ("Francis").</summary>
    public string FounderName { get; init; } = string.Empty;

    /// <summary>Where replies go, so they reach the founder rather than the no-reply sender.</summary>
    public string ReplyTo { get; init; } = string.Empty;

    /// <summary>
    /// The most accounts written to in one run, so a backlog trickles out instead of going at once: at five an
    /// hour over the ten sending hours, at most 50 a day, half the email plan's daily cap.
    /// </summary>
    public int BatchSize { get; init; } = 5;

    public int IntervalMinutes { get; init; } = 60;

    /// <summary>The API's public origin; the unsubscribe link points at its <c>/api/email/unsubscribe</c>.</summary>
    public string ApiBaseUrl { get; init; } = DefaultApiBaseUrl;

    /// <summary>Why nothing will be sent, or null when outreach is on and complete.</summary>
    public string? DisabledReason
        => !Enabled ? "Outreach__Enabled is not true"
            : string.IsNullOrWhiteSpace(FounderName) ? "Outreach__FounderName is not set"
            : string.IsNullOrWhiteSpace(ReplyTo) ? "Outreach__ReplyTo is not set"
            : null;

    public bool IsActive => DisabledReason is null;
}
