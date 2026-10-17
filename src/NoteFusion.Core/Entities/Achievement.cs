using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A badge an account has earned, written once when the practice that earned it was recorded. Unique per
/// (user, code) in the database, so a badge cannot be awarded twice however two takes race.
/// </summary>
public class Achievement : BaseEntity
{
    public const int CodeMaxLength = 40;

    private Achievement() { } // EF Core

    public Guid UserId { get; private set; }
    public string Code { get; private set; } = string.Empty;
    public DateTime AwardedAtUtc { get; private set; }

    public static Achievement Award(Guid userId, string code, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Code = Guard.NotNullOrWhiteSpace(code),
            AwardedAtUtc = utcNow
        };
}
