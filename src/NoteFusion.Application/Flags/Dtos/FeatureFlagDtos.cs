namespace NoteFusion.Application.Flags.Dtos;

/// <summary>
/// <c>GET /api/app/season</c>: which season every surface dresses for right now, as the caller sees it (an admin also
/// sees a season in preview). Mirrored by <c>AppSeason</c> in <c>mobile/src/api/types.ts</c>.
/// </summary>
/// <param name="Christmas">The Christmas season: the capped mark, snow, carols on top of Hymns and the carols path.</param>
public sealed record SeasonDto(bool Christmas);

/// <summary>
/// One flag as the console's Feature flags page draws it (<c>GET /api/admin/features</c>, and the answer to
/// <c>PUT /api/admin/features/{key}</c>).
/// </summary>
/// <param name="Key">"christmas".</param>
/// <param name="Name">"Christmas season".</param>
/// <param name="Enabled">The switch as an admin last set it.</param>
/// <param name="On">On for everyone right now: switched on and before its switch-off moment.</param>
/// <param name="AdminPreview">On for admin accounts whatever the switch says.</param>
/// <param name="AutoOffAt">The last day it is on (West Africa Time); it switches itself off at the midnight after. Null: it stays on until switched off.</param>
/// <param name="AutoOffAtUtc">That midnight, as an instant. Null with <paramref name="AutoOffAt"/>.</param>
/// <param name="SwitchedItselfOff">Switched on, but past its last day: off for everyone with no one having turned it off.</param>
/// <param name="SuggestedAutoOffAt">The next 6 January: the date the console offers when none is set or the set one has passed.</param>
/// <param name="UpdatedAtUtc">When it was last changed; null when it never has been (it is off).</param>
/// <param name="UpdatedByEmail">Who changed it last, as the audit log names them.</param>
public sealed record FeatureFlagDto(
    string Key,
    string Name,
    bool Enabled,
    bool On,
    bool AdminPreview,
    DateOnly? AutoOffAt,
    DateTime? AutoOffAtUtc,
    bool SwitchedItselfOff,
    DateOnly SuggestedAutoOffAt,
    DateTime? UpdatedAtUtc,
    string? UpdatedByEmail);
