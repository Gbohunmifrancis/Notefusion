using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Choirs.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Choirs.Queries;

/// <summary>
/// <c>GET /api/choirs/mine/league</c>: the choir's practice league this week. Everyone in the choir, the director
/// included, ranked by the practice XP earned on the days of the caller's ISO week (Monday to Sunday, in the caller's
/// time zone), read off the same session rows and by the same rules as each singer's own XP
/// (<see cref="PracticeMath.XpByDay"/>: the daily cap and the quest chest). Ties share a place. First names only, as
/// the choir's library shows them. Open while the choir's plan runs, to its director and its singers.
/// </summary>
public sealed record GetChoirLeagueQuery : IRequest<Result<ChoirLeagueDto>>;

public sealed class GetChoirLeagueQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientTimeZone timeZone)
    : IRequestHandler<GetChoirLeagueQuery, Result<ChoirLeagueDto>>
{
    public async Task<Result<ChoirLeagueDto>> Handle(GetChoirLeagueQuery request, CancellationToken ct)
    {
        var library = await ChoirLibrary.OpenAsync(db, currentUser, clock, ct);
        if (library.IsFailure)
            return library.Error;

        var (membership, userId, people) = library.Value;
        var zone = PracticeTime.Resolve(timeZone.Current);
        var weekStart = PracticeTime.WeekStart(PracticeTime.LocalDate(clock.UtcNow, zone));
        var weekEnd = weekStart.AddDays(6);
        var ids = people.Keys.ToList();
        var facts = await db.PracticeSessions.AsNoTracking()
            .Where(s => ids.Contains(s.UserId) && s.LocalDate >= weekStart && s.LocalDate <= weekEnd)
            .Select(s => new { s.UserId, Fact = new PracticeFact(s.Kind, s.Score, s.WholePart, s.LocalDate, s.CreatedAtUtc, s.DrillId) })
            .ToListAsync(ct);
        var byUser = facts.GroupBy(f => f.UserId).ToDictionary(g => g.Key, g => g.Select(f => f.Fact).ToList());

        var standings = people
            .Select(p =>
            {
                var mine = byUser.GetValueOrDefault(p.Key) ?? [];
                return new
                {
                    Id = p.Key,
                    Name = ChoirAccess.FirstName(p.Value),
                    Xp = PracticeMath.TotalXp(mine),
                    Days = mine.Select(f => f.LocalDate).Distinct().Count(),
                };
            })
            .OrderByDescending(s => s.Xp)
            .ThenByDescending(s => s.Days)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var entries = standings
            .Select((s, i) => new ChoirLeagueEntryDto(
                // Ties share the place of the first of them: 1, 1, 3.
                standings.FindIndex(o => o.Xp == s.Xp) + 1,
                s.Name,
                s.Xp,
                s.Days,
                IsYou: s.Id == userId,
                IsDirector: s.Id == membership.Choir.OwnerId))
            .ToList();

        return new ChoirLeagueDto(membership.Choir.Name, weekStart, PracticeTime.NextMidnightUtc(weekEnd, zone), entries);
    }
}
