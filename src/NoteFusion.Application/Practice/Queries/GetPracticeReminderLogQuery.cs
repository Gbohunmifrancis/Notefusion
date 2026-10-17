using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Practice.Queries;

/// <summary>One practice reminder push, for the admin console: who, which day and slot, what it said, how it went.</summary>
public sealed record PracticeReminderRowDto(
    Guid Id,
    Guid UserId,
    string? FullName,
    string? Email,
    DateOnly LocalDate,
    PracticeReminderSlot Slot,
    PracticeReminderKind Kind,
    int Streak,
    string Title,
    string Body,
    bool Sound,
    PracticeReminderStatus Status,
    int Devices,
    int Attempts,
    string? Error,
    DateTime CreatedAtUtc,
    DateTime? SentAtUtc);

/// <summary>How many of one kind of reminder went out in the last seven days, and how many failed.</summary>
public sealed record PracticeReminderKindSummaryDto(PracticeReminderKind Kind, int Sent, int Failed);

/// <param name="Enabled">Whether the sweep is sending (<c>PracticeReminders__Enabled</c>).</param>
/// <param name="SentLast24Hours">Reminders Expo accepted in the last day.</param>
/// <param name="AccountsLast7Days">Accounts reminded at least once in the last week.</param>
public sealed record PracticeReminderOverviewDto(
    bool Enabled,
    int SentLast24Hours,
    int AccountsLast7Days,
    IReadOnlyList<PracticeReminderKindSummaryDto> Kinds,
    IReadOnlyList<PracticeReminderRowDto> Recent);

/// <summary>GET /api/admin/practice-reminders: the reminder sweep's claim rows, newest first (at most 200), with a week's counts.</summary>
public sealed record GetPracticeReminderLogQuery(int Take = 100) : IRequest<Result<PracticeReminderOverviewDto>>;

public sealed class GetPracticeReminderLogQueryHandler : IRequestHandler<GetPracticeReminderLogQuery, Result<PracticeReminderOverviewDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly PracticeReminderSettings _settings;

    public GetPracticeReminderLogQueryHandler(IApplicationDbContext db, IDateTimeProvider clock, PracticeReminderSettings settings)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<PracticeReminderOverviewDto>> Handle(GetPracticeReminderLogQuery request, CancellationToken ct)
    {
        var take = Math.Clamp(request.Take, 1, 200);
        var now = _clock.UtcNow;
        var weekAgo = now.AddDays(-7);

        // At most two short rows per account a day: a week of them is folded in memory.
        var week = await _db.PracticeReminders.AsNoTracking()
            .Where(r => r.CreatedAtUtc >= weekAgo)
            .Select(r => new { r.UserId, r.Kind, r.Status, r.SentAtUtc })
            .ToListAsync(ct);
        var kinds = Enum.GetValues<PracticeReminderKind>()
            .Select(k => new PracticeReminderKindSummaryDto(
                k,
                week.Count(r => r.Kind == k && r.Status == PracticeReminderStatus.Sent),
                week.Count(r => r.Kind == k && r.Status == PracticeReminderStatus.Failed)))
            .ToList();
        var dayAgo = now.AddDays(-1);

        var latest = await _db.PracticeReminders.AsNoTracking()
            .OrderByDescending(r => r.CreatedAtUtc)
            .Take(take)
            .ToListAsync(ct);
        var ids = latest.Select(r => r.UserId).Distinct().ToList();
        var people = await _db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email })
            .ToDictionaryAsync(u => u.Id, ct);

        var recent = latest
            .Select(r => new PracticeReminderRowDto(
                r.Id, r.UserId,
                people.TryGetValue(r.UserId, out var p) ? p.FullName : null,
                people.TryGetValue(r.UserId, out var q) ? q.Email : null,
                r.LocalDate, r.Slot, r.Kind, r.Streak, r.Title, r.Body, r.Sound, r.Status, r.Devices, r.Attempts, r.Error,
                DateTime.SpecifyKind(r.CreatedAtUtc, DateTimeKind.Utc),
                r.SentAtUtc is { } sent ? DateTime.SpecifyKind(sent, DateTimeKind.Utc) : null))
            .ToList();

        return new PracticeReminderOverviewDto(
            _settings.Enabled,
            week.Count(r => r.Status == PracticeReminderStatus.Sent && r.SentAtUtc >= dayAgo),
            week.Select(r => r.UserId).Distinct().Count(),
            kinds,
            recent);
    }
}
