using System.Globalization;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Flags.Dtos;
using NoteFusion.Application.Flags.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Flags.Commands;

/// <summary>
/// <c>PUT /api/admin/features/{key}</c>: changes any of a flag's switch (<see cref="Enabled"/>), its admin preview
/// (<see cref="AdminPreview"/>) and when it switches itself off; what is left out stays as it is.
/// <see cref="AutoOff"/> false clears the switch-off date (it stays on until switched off); true keeps one —
/// <see cref="AutoOffAt"/>, else the one set if it is still ahead, else the next 6 January — and a date alone sets it.
/// Turning a flag on whose date has passed, with no new one given, moves it to the next 6 January, so "on" means on;
/// a flag that switched itself off is off, and changing its preview or its date leaves it off.
/// Every change is written to the audit log with who made it; a save that changes nothing writes nothing.
/// </summary>
public sealed record SetFeatureFlagCommand(
    string Key,
    bool? Enabled = null,
    bool? AdminPreview = null,
    bool? AutoOff = null,
    DateOnly? AutoOffAt = null) : IRequest<Result<FeatureFlagDto>>;

public sealed class SetFeatureFlagCommandHandler : IRequestHandler<SetFeatureFlagCommand, Result<FeatureFlagDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _caller;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public SetFeatureFlagCommandHandler(IApplicationDbContext db, ICurrentUser caller, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _caller = caller;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result<FeatureFlagDto>> Handle(SetFeatureFlagCommand request, CancellationToken ct)
    {
        var key = request.Key?.Trim().ToLowerInvariant();
        if (key is null || !FeatureFlags.IsKnown(key))
            return FeatureFlagErrors.Unknown;
        if (_caller.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;

        var now = _clock.UtcNow;
        var today = FeatureFlags.Today(now);
        var nextSixth = FeatureFlags.SwitchOffAtUtc(FeatureFlags.DefaultLastDay(today));

        var flag = await _db.FeatureFlags.FirstOrDefaultAsync(f => f.Key == key, ct);
        var isNew = flag is null;
        // Never changed: off, no preview, and the default end the console showed.
        flag ??= FeatureFlag.Create(key, nextSixth, now);

        // A flag that switched itself off is off: changing its preview or its date leaves it off, and only turning it
        // on brings it back.
        var wasOn = flag.IsOn(now);
        var before = (Enabled: wasOn, flag.AdminPreview, flag.AutoOffAtUtc);

        var enabled = request.Enabled ?? wasOn;
        var preview = request.AdminPreview ?? flag.AdminPreview;
        var autoOffAt = request.AutoOff switch
        {
            false => null,
            true => request.AutoOffAt is { } day ? FeatureFlags.SwitchOffAtUtc(day)
                : flag.AutoOffAtUtc is { } kept && kept > now ? kept
                : nextSixth,
            null => request.AutoOffAt is { } day ? FeatureFlags.SwitchOffAtUtc(day) : flag.AutoOffAtUtc,
        };
        // Turned on with a date that has gone and no new one: the next 6 January, not an "on" that is off.
        if (enabled && !wasOn && request.AutoOffAt is null && autoOffAt is { } stale && stale <= now)
            autoOffAt = nextSixth;
        if (enabled && autoOffAt is { } off && off <= now)
            return FeatureFlagErrors.AutoOffPassed;

        // Nothing changed (a first save of the defaults included): nothing to store or to put in the trail.
        if ((enabled, preview, autoOffAt) == before)
            return GetFeatureFlagsQueryHandler.Describe(key, isNew ? null : flag, now);

        flag.Set(enabled, preview, autoOffAt, actorId, _caller.Email ?? $"user:{actorId}", now);
        if (isNew)
            _db.FeatureFlags.Add(flag);

        _audit.Record(AdminAuditAction.SetFeatureFlag, null, Summary(FeatureFlags.NameOf(key), before, (enabled, preview, autoOffAt)));

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (isNew)
        {
            // The unique key: another admin's first save of this flag landed a moment before this one.
            return FeatureFlagErrors.Conflict;
        }

        return GetFeatureFlagsQueryHandler.Describe(key, flag, now);
    }

    /// <summary>
    /// The audit line: each part that changed, in words ("Turned the Christmas season on for everyone; it switches
    /// itself off after 6 Jan 2027.").
    /// </summary>
    internal static string Summary(
        string name,
        (bool On, bool Preview, DateTime? AutoOff) before,
        (bool On, bool Preview, DateTime? AutoOff) after)
    {
        var parts = new List<string>();
        if (after.On != before.On)
            parts.Add(after.On ? $"turned the {name} on for everyone" : $"turned the {name} off for everyone");
        if (after.Preview != before.Preview)
            parts.Add(after.Preview ? $"turned the {name} preview for admins on" : $"turned the {name} preview for admins off");
        if (after.AutoOff != before.AutoOff)
        {
            var subject = parts.Count > 0 ? "it" : $"the {name}";
            parts.Add(after.AutoOff is { } off
                ? $"{subject} switches itself off after {FeatureFlags.LastDay(off).ToString("d MMM yyyy", CultureInfo.InvariantCulture)}"
                : $"{subject} has no switch-off date: it stays on until someone switches it off");
        }
        var sentence = string.Join("; ", parts);
        return char.ToUpperInvariant(sentence[0]) + sentence[1..] + ".";
    }
}
