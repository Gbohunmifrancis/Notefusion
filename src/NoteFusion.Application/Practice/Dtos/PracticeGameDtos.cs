using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Dtos;

// ── A deal (GET /api/practice/games/{game}) ─────────────────────────────────

/// <summary>
/// GET /api/practice/games/{game} ("which-note", "staff", "hymn"): a fresh deal of a quick game, tapped not sung. Every
/// round carries its answer, so the app can say at once whether a tap was right; the marks that count are the server's,
/// rebuilt from <c>DealId</c> when the answers come back (<c>POST /api/practice/games/grade</c>). <c>TimeLimitSeconds</c>
/// is set for a race (Staff to solfa): answer as many rounds as the time allows. <c>GamesToday</c> of
/// <c>GamesPerDay</c> have earned XP today.
/// </summary>
public sealed record PracticeGameDto(
    string Game,
    string DealId,
    PracticeTrack? Track,
    int? TimeLimitSeconds,
    int GamesToday,
    int GamesPerDay,
    IReadOnlyList<PracticeGameRoundDto> Rounds);

/// <summary>
/// One round. <c>Choices</c> are what can be tapped and <c>Answer</c> the right one (a syllable "s", or a hymn's slug).
/// Which note: the app plays <c>DohMidi</c>, then <c>NoteMidi</c>. Staff to solfa: <c>NoteName</c> ("F#4") drawn on a
/// treble stave with <c>Fifths</c> in the key signature (sharps positive, flats negative); <c>NoteMidi</c> sounds it.
/// Name that hymn: <c>Notes</c> at <c>TempoBpm</c> in <c>TimeSignature</c>, the opening of the hymn whose slug is the
/// answer, in <c>Key</c> (to write its solfa when it is revealed); <c>Hymns</c> names each choice.
/// </summary>
public sealed record PracticeGameRoundDto(
    int Index,
    string Answer,
    IReadOnlyList<string> Choices,
    string? Doh,
    string? Key,
    int? Fifths,
    int? DohMidi,
    int? NoteMidi,
    string? NoteName,
    int? TempoBpm,
    string? TimeSignature,
    IReadOnlyList<GameNoteDto>? Notes,
    IReadOnlyList<GameHymnDto>? Hymns);

/// <summary>A note the app plays, in quarter-note beats.</summary>
public sealed record GameNoteDto(int PitchMidi, double StartBeat, double DurBeats);

/// <summary>A hymn offered as a choice: its slug (the answer's form), title and first line (null for a tune page).</summary>
public sealed record GameHymnDto(string Slug, string Title, string? FirstLine);

// ── The answers marked (POST /api/practice/games/grade) ─────────────────────

/// <summary>
/// A deal's answers marked by the server. <c>Marks</c> is right or wrong per round answered. <c>Score</c> is the share
/// right: of every round in a game of rounds (a round left unanswered is wrong), of the rounds answered in a race.
/// <c>Counted</c>: the game earned XP and counts as practice today; when it did not, <c>NotCounted</c> says why
/// ("daily": the day's games that earn XP are used; "few": too few rounds answered) and <c>Reward</c> is null.
/// </summary>
public sealed record PracticeGameGradeDto(
    string Game,
    string DealId,
    int Score,
    int Right,
    int Answered,
    int Rounds,
    IReadOnlyList<bool> Marks,
    bool Counted,
    string? NotCounted,
    PracticeRewardDto? Reward);
