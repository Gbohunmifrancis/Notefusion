using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Practice;

/// <summary>
/// Writes a graded practice and awards what it earned: the row, any badges it unlocks (one <see cref="Achievement"/>
/// each, once), and the reward the client celebrates. Called only by the two grade handlers, after the worker has
/// marked the take — the server records practice; no client reports it.
/// </summary>
/// <remarks>
/// The caller holds <see cref="GateKey"/> for the account while it records, so two takes finishing together cannot
/// both find a badge missing; the unique (user, code) index is the backstop.
/// </remarks>
public sealed class PracticeRecorder
{
    private readonly IApplicationDbContext _db;

    public PracticeRecorder(IApplicationDbContext db) => _db = db;

    /// <summary>The <see cref="IQuotaGate"/> key an account's practice is counted and recorded under.</summary>
    public static string GateKey(Guid userId) => $"practice:{userId}";

    public async Task<PracticeRewardDto> RecordAsync(PracticeSession session, CancellationToken ct)
    {
        var facts = await FactsAsync(_db, session.UserId, ct);
        var before = PracticeMath.TotalXp(facts);

        _db.PracticeSessions.Add(session);
        facts.Add(Fact(session));
        var after = PracticeMath.TotalXp(facts);

        var stats = PracticeMath.Stats(facts, session.LocalDate);
        var earned = (await _db.Achievements
                .Where(a => a.UserId == session.UserId)
                .Select(a => a.Code)
                .ToListAsync(ct))
            .ToHashSet();
        var unlocked = PracticeBadges.Unlocked(stats, earned);
        foreach (var badge in unlocked)
            _db.Achievements.Add(Achievement.Award(session.UserId, badge.Code, session.CreatedAtUtc));

        await _db.SaveChangesAsync(ct);

        var level = PracticeMath.LevelFor(after);
        return new PracticeRewardDto(
            after - before,
            after,
            level.Index > PracticeMath.LevelFor(before).Index,
            level,
            PracticeMath.Streak(facts.Select(f => f.LocalDate), session.LocalDate).Current,
            unlocked.Select(b => PracticeBadges.Describe(b, stats, session.CreatedAtUtc)).ToList());
    }

    /// <summary>An account's graded practice, as the scoring reads it.</summary>
    public static async Task<List<PracticeFact>> FactsAsync(IApplicationDbContext db, Guid userId, CancellationToken ct)
        => await db.PracticeSessions
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .Select(s => new PracticeFact(s.Kind, s.Score, s.WholePart, s.LocalDate, s.CreatedAtUtc))
            .ToListAsync(ct);

    private static PracticeFact Fact(PracticeSession s) => new(s.Kind, s.Score, s.WholePart, s.LocalDate, s.CreatedAtUtc);
}
