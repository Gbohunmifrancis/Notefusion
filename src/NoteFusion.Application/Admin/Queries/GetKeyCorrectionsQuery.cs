using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// The doh the engine heard against the doh the user kept, for the saved sheets of the last
/// <paramref name="Days"/> days (newest first, at most <paramref name="Limit"/>): how often the doh is
/// corrected, how often the "or is it…?" prompt held the right one, and the rows themselves as training
/// data for the doh chooser (<paramref name="IncludeRows"/>; the counts alone are what the console shows).
/// </summary>
/// <remarks>
/// Nothing is stored for this: a saved sheet keeps its key and notes, and the job it came from keeps the
/// result as the engine wrote it (<see cref="TranscriptionJob.ResultJson"/>). Rows carry no account, title,
/// lyrics or ids — only keys and pitches.
/// </remarks>
public sealed record GetKeyCorrectionsQuery(int Days = 30, int Limit = 500, bool IncludeRows = false)
    : IRequest<Result<KeyCorrectionsDto>>
{
    public const int MaxLimit = 2000;
    public const int MaxDays = 365;
}

public sealed class GetKeyCorrectionsQueryHandler : IRequestHandler<GetKeyCorrectionsQuery, Result<KeyCorrectionsDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetKeyCorrectionsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<KeyCorrectionsDto>> Handle(GetKeyCorrectionsQuery request, CancellationToken ct)
    {
        var days = Math.Clamp(request.Days, 1, GetKeyCorrectionsQuery.MaxDays);
        var limit = Math.Clamp(request.Limit, 1, GetKeyCorrectionsQuery.MaxLimit);
        var since = _clock.UtcNow.AddDays(-days);

        var pairs = await (
                from t in _db.Transcriptions.AsNoTracking()
                join j in _db.TranscriptionJobs.AsNoTracking() on t.SourceJobId equals j.JobId
                where t.CreatedAtUtc >= since && j.UserId == t.UserId && j.ResultJson != null
                orderby t.CreatedAtUtc descending
                select new { Sheet = t, j.ResultJson, j.Kind })
            .Take(limit)
            .ToListAsync(ct);

        var rows = new List<KeyCorrectionRowDto>(pairs.Count);
        foreach (var pair in pairs)
        {
            var heard = TranscriptionResultCache.Deserialize(pair.ResultJson!);
            if (heard is null || KeyParser.Parse(heard.Key) is not { IsSuccess: true } detected)
                continue;

            var heardPitches = heard.Notes.Select(n => n.PitchMidi).ToList();
            var keptPitches = pair.Sheet.Notes.Select(n => n.PitchMidi).ToList();
            var transposed = Transposition(heardPitches, keptPitches);
            var kept = pair.Sheet.Key;
            var detectedDoh = detected.Value.DohPitchClass;
            var keptDoh = Mod12(kept.DohPitchClass - transposed);

            var offered = (heard.KeyAlternatives ?? [])
                .Select(a => KeyParser.Parse(a.Key))
                .Where(k => k.IsSuccess)
                .Select(k => k.Value.DohPitchClass)
                .ToList();

            rows.Add(new KeyCorrectionRowDto(
                pair.Sheet.CreatedAtUtc.Date,
                pair.Kind.ToString(),
                heard.Key,
                heard.KeyConfidence,
                heard.KeyAlternatives?.Select(a => a.Key).ToList() ?? [],
                kept.ToString(),
                transposed,
                keptDoh != detectedDoh,
                offered.Contains(keptDoh),
                heard.Notes.Select(n => new KeyCorrectionNoteDto(n.PitchMidi, n.DurBeats)).ToList(),
                pair.Sheet.Notes.Select(n => new KeyCorrectionNoteDto(n.PitchMidi, n.DurationBeats)).ToList()));
        }

        return new KeyCorrectionsDto(
            days,
            rows.Count,
            rows.Count(r => r.DohChanged),
            rows.Count(r => r.OfferedKeys.Count > 0),
            rows.Count(r => r.DohChanged && r.KeptOfferedDoh),
            request.IncludeRows ? rows : []);
    }

    /// <summary>
    /// The semitones "Transpose for my choir" moved the sheet by: the shift most of the notes share, when
    /// the note lists still line up. Zero when they do not, or when nothing moved.
    /// </summary>
    private static int Transposition(IReadOnlyList<int> heard, IReadOnlyList<int> kept)
    {
        if (heard.Count == 0 || heard.Count != kept.Count)
            return 0;
        var shift = heard.Zip(kept, (h, k) => k - h)
            .GroupBy(d => d)
            .OrderByDescending(g => g.Count())
            .First();
        return shift.Count() * 2 > heard.Count ? shift.Key : 0;
    }

    private static int Mod12(int value) => ((value % 12) + 12) % 12;
}
