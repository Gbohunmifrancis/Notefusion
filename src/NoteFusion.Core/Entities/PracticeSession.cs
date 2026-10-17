using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// One graded practice: a take the server marked, written by the server the moment the worker answered — never
/// reported by a client. XP, levels, streaks and badges are all read off these rows (<c>Application/Practice</c>),
/// so a rule change re-scores history instead of leaving stored points behind.
/// </summary>
/// <remarks>
/// <see cref="LocalDate"/> is the singer's own calendar day when it was recorded (from the client's time zone,
/// Africa/Lagos when none was sent): a streak is about their evenings, not UTC's. <see cref="TranscriptionId"/>
/// is a plain id, not a foreign key, so deleting a sheet leaves its practice history (and its streak) intact.
/// </remarks>
public class PracticeSession : BaseEntity
{
    public const int DrillIdMaxLength = 64;

    private PracticeSession() { } // EF Core

    public Guid UserId { get; private set; }
    public PracticeKind Kind { get; private set; }

    /// <summary>The sheet the part came from, when it was a saved one the singer can open; null for a drill.</summary>
    public Guid? TranscriptionId { get; private set; }

    /// <summary>"S", "A", "T" or "B" for a part; null for a drill or a part not named.</summary>
    public string? Part { get; private set; }

    /// <summary>The catalogue drill sung (<c>DrillCatalogue</c> id); null for a part.</summary>
    public string? DrillId { get; private set; }

    /// <summary>The worker's mark, 0–100.</summary>
    public int Score { get; private set; }

    public int Hits { get; private set; }
    public int Near { get; private set; }
    public int Wrong { get; private set; }
    public int Missed { get; private set; }

    /// <summary>How long the passage sung lasts, count-in excluded.</summary>
    public double DurationSec { get; private set; }

    /// <summary>True when the take covered every note of a saved sheet's part (the "whole part" badge).</summary>
    public bool WholePart { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }
    public DateOnly LocalDate { get; private set; }

    public static PracticeSession Record(
        Guid userId,
        PracticeKind kind,
        int score,
        int hits,
        int near,
        int wrong,
        int missed,
        double durationSec,
        DateTime createdAtUtc,
        DateOnly localDate,
        string? drillId = null,
        Guid? transcriptionId = null,
        string? part = null,
        bool wholePart = false)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Kind = kind,
            Score = Math.Clamp(score, 0, 100),
            Hits = Math.Max(0, hits),
            Near = Math.Max(0, near),
            Wrong = Math.Max(0, wrong),
            Missed = Math.Max(0, missed),
            DurationSec = Math.Max(0, durationSec),
            CreatedAtUtc = createdAtUtc,
            LocalDate = localDate,
            DrillId = drillId,
            TranscriptionId = transcriptionId,
            Part = part,
            WholePart = wholePart
        };
}
