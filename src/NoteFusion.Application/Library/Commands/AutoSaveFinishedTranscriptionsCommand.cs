using System.Globalization;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// Keeps every finished transcription in its owner's library, whether or not they pressed Save.
/// </summary>
/// <remarks>
/// Nine in ten finished transcriptions were never saved, and an unsaved one is lost the moment its
/// screen closes, so most accounts had nothing to come back to. The result is already on the job row
/// (<see cref="TranscriptionJob.ResultJson"/>); this sweep turns it into a library sheet once the job has
/// been finished for <see cref="Delay"/>, long enough for the result screen's own choices (which doh, the
/// title, Save itself) to come first. A sheet saved by hand in that window is left as it is, and a
/// Save pressed after the sweep replaces the kept copy (<see cref="SaveTranscriptionCommand"/>). Each job
/// is handled once, so a sheet the user deletes afterwards stays deleted.
/// </remarks>
public sealed record AutoSaveFinishedTranscriptionsCommand : IRequest<Result<int>>
{
    /// <summary>How long a finished job is left for its result screen before it is kept.</summary>
    public static readonly TimeSpan Delay = TimeSpan.FromMinutes(30);

    /// <summary>Jobs older than this are left alone: the sweep is for new work, not an archive dig.</summary>
    public static readonly TimeSpan Lookback = TimeSpan.FromDays(14);

    public const int BatchSize = 50;
}

public sealed class AutoSaveFinishedTranscriptionsCommandHandler
    : IRequestHandler<AutoSaveFinishedTranscriptionsCommand, Result<int>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public AutoSaveFinishedTranscriptionsCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<int>> Handle(AutoSaveFinishedTranscriptionsCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var readyBefore = now - AutoSaveFinishedTranscriptionsCommand.Delay;
        var notBefore = now - AutoSaveFinishedTranscriptionsCommand.Lookback;

        var jobs = await _db.TranscriptionJobs
            .Where(j => j.ResultJson != null
                        && j.AutoSavedAtUtc == null
                        && j.CreatedAtUtc < readyBefore
                        && j.CreatedAtUtc >= notBefore)
            .OrderBy(j => j.CreatedAtUtc)
            .Take(AutoSaveFinishedTranscriptionsCommand.BatchSize)
            .ToListAsync(ct);

        if (jobs.Count == 0)
            return 0;

        var jobIds = jobs.Select(j => j.JobId).ToList();
        var userIds = jobs.Select(j => j.UserId).Distinct().ToList();
        var alreadySaved = await _db.Transcriptions
            .Where(t => t.SourceJobId != null && jobIds.Contains(t.SourceJobId))
            .Select(t => new { t.UserId, t.SourceJobId })
            .ToListAsync(ct);
        var saved = alreadySaved.Select(t => (t.UserId, t.SourceJobId!)).ToHashSet();
        var liveUsers = (await _db.Users.Where(u => userIds.Contains(u.Id)).Select(u => u.Id).ToListAsync(ct)).ToHashSet();

        var kept = 0;
        foreach (var job in jobs)
        {
            job.MarkAutoSaved(now);

            if (saved.Contains((job.UserId, job.JobId)) || !liveUsers.Contains(job.UserId))
                continue;
            if (TranscriptionResultCache.Deserialize(job.ResultJson!) is not { } result)
                continue;
            if (ToSheet(job, result) is not { } sheet)
                continue;

            _db.Transcriptions.Add(sheet);
            kept++;
        }

        await _db.SaveChangesAsync(ct);
        return kept;
    }

    /// <summary>The sheet the result screen would have saved, with the title it would have suggested.</summary>
    private static Transcription? ToSheet(TranscriptionJob job, TranscriptionResultDto result)
    {
        if (string.IsNullOrWhiteSpace(result.MusicXml) || result.Notes.Count == 0)
            return null;

        var key = KeyParser.Parse(result.Key);
        if (key.IsFailure)
            return null;

        var notes = result.Notes.Select(n => new NoteEvent
        {
            PitchMidi = n.PitchMidi,
            StartBeat = n.StartBeat,
            DurationBeats = n.DurBeats,
            Confidence = n.Conf
        });

        var sheet = new Transcription(
            job.UserId,
            TitleFor(job, result),
            key.Value,
            Math.Clamp(result.Tempo, 20, 300),
            string.IsNullOrWhiteSpace(result.TimeSignature) ? "4/4" : result.TimeSignature,
            result.MusicXml,
            notes,
            Math.Clamp(result.OverallConfidence, 0.0, 1.0),
            job.JobId);

        sheet.SetParts(PartNotes.FromDtos(result.Parts),
            string.IsNullOrWhiteSpace(result.PartsMusicXml) ? null : result.PartsMusicXml);
        sheet.SetChords(SheetChords.FromDtos(result.Chords));
        return sheet;
    }

    /// <summary>
    /// "Song — Artist" for a linked song, as the web app suggests; otherwise what and when, e.g.
    /// "Recording in G major · 9 Oct", which tells two of an afternoon's takes apart in the list.
    /// </summary>
    private static string TitleFor(TranscriptionJob job, TranscriptionResultDto result)
    {
        var src = result.Source;
        var title = src is not null && !string.IsNullOrWhiteSpace(src.Title)
            ? src.Title.Trim() + (string.IsNullOrWhiteSpace(src.Artist) ? "" : " — " + src.Artist.Trim())
            : $"Recording in {result.Key} · {job.CreatedAtUtc.ToString("d MMM", CultureInfo.InvariantCulture)}";
        return title.Length <= 120 ? title : title[..120];
    }
}
