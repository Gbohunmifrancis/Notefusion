using NoteFusion.Core.Seedwork;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One thing an account did, as the server saw it: a sign-in, a sheet renamed or deleted, a folder moved, a choir joined,
/// a checkout opened, a membership cancelled. Written by the API itself as the request succeeds, so unlike the phone's and
/// the website's own events it cannot be lost on the way: it is the backbone of the console's activity feed.
/// </summary>
/// <remarks>
/// A name (<c>sign_in</c>, <c>library.rename</c>) and flat <c>key=value;…</c> details: how they signed in, from which
/// client, which sheet id. Never what someone typed: no titles, notes, words, links or passwords. Deleted with the
/// account (one <c>account_deleted</c> row is kept, with no name or address) and after <see cref="RetentionDays"/>.
/// </remarks>
public class UserActivity : BaseEntity
{
    public const int NameMaxLength = 80;
    public const int DetailMaxLength = 300;

    /// <summary>Two years: long enough to read a customer's whole story back, short enough not to keep it for ever.</summary>
    public const int RetentionDays = 730;

    /// <summary>Signed in with a password, Google, a passkey or an email link (detail <c>method=…;client=…</c>).</summary>
    public const string SignIn = "sign_in";

    /// <summary>An account was created (detail <c>method=…;client=…</c>).</summary>
    public const string SignUp = "sign_up";

    /// <summary>The account was deleted; the only row kept after it.</summary>
    public const string AccountDeleted = "account_deleted";

    private UserActivity() { } // EF Core

    public Guid UserId { get; private set; }

    /// <summary>Lower-case words, dots and underscores (<c>sign_in</c>, <c>library.rename</c>).</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Flat <c>key=value;…</c> pairs; null when there are none.</summary>
    public string? Detail { get; private set; }

    /// <summary>"phone" or "web" when the request said which; null otherwise.</summary>
    public string? Client { get; private set; }

    public DateTime OccurredAtUtc { get; private set; }

    public static UserActivity Record(Guid userId, string name, string? detail, string? client, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = Cut(name.Trim().ToLowerInvariant(), NameMaxLength)!,
            Detail = Cut(detail, DetailMaxLength),
            Client = client is "phone" or "web" ? client : null,
            OccurredAtUtc = utcNow,
        };

    private static string? Cut(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;
        var kept = new string(value.Where(c => !char.IsControl(c)).ToArray()).Trim();
        return kept.Length <= max ? kept : kept[..max];
    }
}
