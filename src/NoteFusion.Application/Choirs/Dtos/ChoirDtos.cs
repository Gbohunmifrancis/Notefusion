using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Choirs.Dtos;

/// <summary>The caller's choir.</summary>
/// <param name="Role"><c>"director"</c> (the payer) or <c>"member"</c> (a singer).</param>
/// <param name="IsActive">The choir's plan is running: its singers are Pro and its library is open.</param>
/// <param name="DirectorName">The director's first name.</param>
/// <param name="InviteCode">The code singers join with; sent to the director only, null for a singer.</param>
/// <param name="SeatsUsed">Singers in the choir, the director not counted.</param>
/// <param name="SeatsTotal">Singers the plan seats besides the director.</param>
/// <param name="SongCreditsRemaining">Songs left this month in the choir's shared pool (running ones held).</param>
/// <param name="SongCreditsTotal">The choir's monthly pool.</param>
public sealed record ChoirDto(
    Guid Id,
    string Name,
    string Role,
    bool IsActive,
    DateTime CurrentPeriodEndUtc,
    string? PlanCode,
    string? PlanName,
    string DirectorName,
    string? InviteCode,
    int SeatsUsed,
    int SeatsTotal,
    int SongCreditsRemaining,
    int SongCreditsTotal);

/// <summary>A singer, as the director's member list shows them.</summary>
public sealed record ChoirMemberDto(Guid UserId, string Name, DateTime JoinedAtUtc);

/// <summary>
/// One sheet in the choir's library: enough for a list row (as a library row has), opened read-only with
/// <c>GET api/choirs/mine/sheets/{id}</c>.
/// </summary>
/// <param name="SharedBy">The first name of the singer who shared it.</param>
/// <param name="Mine">The caller shared it.</param>
/// <param name="CanUnshare">The caller may take it out of the library: their own sheet, or any sheet for the director.</param>
public sealed record ChoirSheetDto(
    Guid Id,
    string Title,
    string Key,
    string SharedBy,
    bool Mine,
    bool CanUnshare,
    DateTime CreatedAtUtc,
    IReadOnlyList<NoteEventDto> Preview);

/// <summary>The choir's practice league this week: its name, the week (Monday), when it starts afresh, and the table.</summary>
public sealed record ChoirLeagueDto(string ChoirName, DateOnly WeekStart, DateTime ResetsAtUtc, IReadOnlyList<ChoirLeagueEntryDto> Entries);

/// <summary>One singer's line in the league: their place (ties share one), first name, XP this week and days practised.</summary>
public sealed record ChoirLeagueEntryDto(int Rank, string Name, int Xp, int Days, bool IsYou, bool IsDirector);
