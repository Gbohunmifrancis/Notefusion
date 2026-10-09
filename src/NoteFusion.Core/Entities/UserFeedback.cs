using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// Something a user told us: a feedback message, a star rating (or "not now" to the rating prompt), or
/// where they heard about NoteFusion. One table because the admin console reads them side by side and
/// the prompts ask "has this account answered yet?" of all three.
/// </summary>
public class UserFeedback : BaseEntity
{
    public const string FeedbackKind = "feedback";
    public const string RatingKind = "rating";
    public const string RatingDismissedKind = "rating_dismissed";
    public const string HeardAboutKind = "heard_about";

    public const int MessageMaxLength = 2000;
    public const int ShortMaxLength = 40;
    public const int DetailMaxLength = 200;

    /// <summary>The categories a feedback message may be filed under; anything else is "other".</summary>
    public static readonly string[] Categories = ["bug", "idea", "accuracy", "payments", "other"];

    /// <summary>The answers to "where did you hear about us?"; anything else is "other".</summary>
    public static readonly string[] HeardAboutSources =
    [
        "friend", "church", "whatsapp", "instagram", "tiktok", "youtube", "facebook", "x",
        "google", "play_store", "other"
    ];

    private UserFeedback() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary><see cref="FeedbackKind"/>, <see cref="RatingKind"/>, <see cref="RatingDismissedKind"/> or <see cref="HeardAboutKind"/>.</summary>
    public string Kind { get; private set; } = FeedbackKind;

    /// <summary>1–5 stars, for a rating.</summary>
    public int? Rating { get; private set; }

    /// <summary>A feedback message's category, or the "heard about us" source.</summary>
    public string? Category { get; private set; }

    /// <summary>The message itself, a rating's comment, or the free text after "other".</summary>
    public string? Message { get; private set; }

    /// <summary>"web" or "app".</summary>
    public string Client { get; private set; } = "app";

    /// <summary>The app's version, when the app sent it.</summary>
    public string? AppVersion { get; private set; }

    /// <summary>Where in the app it was sent from, e.g. "Result" or "Help".</summary>
    public string? Screen { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public static UserFeedback Feedback(Guid userId, string? category, string message, string client, string? appVersion, string? screen, DateTime utcNow)
        => Create(userId, FeedbackKind, null, OneOf(category, Categories), Guard.NotNullOrWhiteSpace(message), client, appVersion, screen, utcNow);

    public static UserFeedback Rate(Guid userId, int rating, string? comment, string client, string? appVersion, string? screen, DateTime utcNow)
        => Create(userId, RatingKind, rating is >= 1 and <= 5 ? rating : throw new ArgumentOutOfRangeException(nameof(rating)),
            null, comment, client, appVersion, screen, utcNow);

    public static UserFeedback DismissRating(Guid userId, string client, string? appVersion, string? screen, DateTime utcNow)
        => Create(userId, RatingDismissedKind, null, null, null, client, appVersion, screen, utcNow);

    public static UserFeedback HeardAbout(Guid userId, string source, string? detail, string client, string? appVersion, DateTime utcNow)
        => Create(userId, HeardAboutKind, null, OneOf(source, HeardAboutSources), detail, client, appVersion, null, utcNow);

    private static UserFeedback Create(
        Guid userId, string kind, int? rating, string? category, string? message, string client, string? appVersion, string? screen, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Kind = kind,
            Rating = rating,
            Category = category,
            Message = Clip(message, MessageMaxLength),
            Client = client == "web" ? "web" : "app",
            AppVersion = Clip(appVersion, ShortMaxLength),
            Screen = Clip(screen, ShortMaxLength),
            CreatedAtUtc = utcNow
        };

    private static string OneOf(string? value, string[] allowed)
    {
        var v = value?.Trim().ToLowerInvariant();
        return v is not null && allowed.Contains(v) ? v : "other";
    }

    private static string? Clip(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        value = value.Trim();
        return value.Length <= max ? value : value[..max];
    }
}
