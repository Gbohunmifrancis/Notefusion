using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Flags.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Flags.Queries;

/// <summary>
/// <c>GET /api/app/season</c>, anonymous: the season every surface dresses for as the caller sees it. A signed-in admin
/// also sees a season in preview; everyone else, the season as it is for everyone.
/// </summary>
public sealed record GetSeasonQuery : IRequest<Result<SeasonDto>>;

/// <summary><c>GET /api/admin/features</c>: every flag the console lists, as it stands (off when never changed).</summary>
public sealed record GetFeatureFlagsQuery : IRequest<Result<IReadOnlyList<FeatureFlagDto>>>;

public sealed class GetSeasonQueryHandler : IRequestHandler<GetSeasonQuery, Result<SeasonDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly ICurrentUser _caller;

    public GetSeasonQueryHandler(IApplicationDbContext db, IDateTimeProvider clock, ICurrentUser caller)
    {
        _db = db;
        _clock = clock;
        _caller = caller;
    }

    public async Task<Result<SeasonDto>> Handle(GetSeasonQuery request, CancellationToken ct)
        => new SeasonDto(await FeatureFlags.ChristmasForCallerAsync(_db, _clock.UtcNow, _caller, ct));
}

public sealed class GetFeatureFlagsQueryHandler : IRequestHandler<GetFeatureFlagsQuery, Result<IReadOnlyList<FeatureFlagDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetFeatureFlagsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<IReadOnlyList<FeatureFlagDto>>> Handle(GetFeatureFlagsQuery request, CancellationToken ct)
    {
        var keys = FeatureFlags.Known.Select(k => k.Key).ToList();
        var rows = await _db.FeatureFlags.AsNoTracking().Where(f => keys.Contains(f.Key)).ToListAsync(ct);
        var now = _clock.UtcNow;
        IReadOnlyList<FeatureFlagDto> flags = FeatureFlags.Known
            .Select(k => Describe(k.Key, rows.FirstOrDefault(r => r.Key == k.Key), now))
            .ToList();
        return Result.Success(flags);
    }

    /// <summary>
    /// A flag for the console. With no row it is off, never changed, and would switch itself off after the next 6 January
    /// once turned on (what the first save stores unless the admin unticks it).
    /// </summary>
    public static FeatureFlagDto Describe(string key, FeatureFlag? flag, DateTime utcNow)
    {
        var suggested = FeatureFlags.DefaultLastDay(FeatureFlags.Today(utcNow));
        if (flag is null)
        {
            return new FeatureFlagDto(
                key, FeatureFlags.NameOf(key), Enabled: false, On: false, AdminPreview: false,
                suggested, FeatureFlags.SwitchOffAtUtc(suggested), SwitchedItselfOff: false, suggested, null, null);
        }

        return new FeatureFlagDto(
            flag.Key,
            FeatureFlags.NameOf(flag.Key),
            flag.Enabled,
            flag.IsOn(utcNow),
            flag.AdminPreview,
            flag.AutoOffAtUtc is { } off ? FeatureFlags.LastDay(off) : null,
            flag.AutoOffAtUtc,
            flag.SwitchedItselfOff(utcNow),
            suggested,
            flag.UpdatedByUserId is null ? null : flag.UpdatedAtUtc,
            flag.UpdatedByEmail);
    }
}
