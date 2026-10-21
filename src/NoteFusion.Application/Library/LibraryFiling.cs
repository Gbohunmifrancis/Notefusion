using System.Globalization;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Library;

/// <summary>
/// Files every finished transcription in its owner's library the moment its job is settled Done (the client's
/// poll, <c>GetTranscriptionJobQuery</c>, or the completion step, <c>NotifyTranscriptionReadyCommand</c>):
/// a take is never lost to a closed screen. The sheet is marked <see cref="Transcription.SavedAutomatically"/>
/// and unopened, named after the hymn it recognised, else "Recording · Sun 17:10" in the owner's time zone.
/// </summary>
/// <remarks>
/// One sheet per job, under the account's save lock (<see cref="QuotaGateExtensions.SaveKey"/>), the same lock
/// <see cref="SaveTranscriptionCommand"/> and the library sweep take: a Save landing while the job is filed
/// cannot leave two sheets, and a Save afterwards replaces the filed copy. Each job is filed once
/// (<see cref="TranscriptionJob.AutoSavedAtUtc"/>), so a sheet the owner deletes stays deleted. The sweep
/// (<see cref="AutoSaveFinishedTranscriptionsCommand"/>) remains as the fallback for a job this missed.
/// A free owner is filed what the poll hands them (<see cref="ProGate.ForFree"/>), never more.
/// <para>
/// The sheet keeps the job's beat clock, and for the owner's own upload of a song the backing the worker separated
/// (<see cref="IBackingStorage"/>): this is the one moment the bytes are in hand, since the job's banked copy
/// (<see cref="TranscriptionResultCache"/>) drops them and the worker forgets the job within minutes. A pasted
/// link's sheet never keeps it (<see cref="Transcription.FromLink"/>).
/// </para>
/// </remarks>
public static class LibraryFiling
{
    /// <summary>
    /// The sheet for a finished job: the one already filed for it, or a new one filed now. Null when the job was
    /// filed before and the sheet deleted since, when the account is gone, or when the result has nothing to write.
    /// </summary>
    public static async Task<Transcription?> FileAsync(
        IApplicationDbContext db, IQuotaGate gate, IDateTimeProvider clock, IBackingStorage backing, TranscriptionJob job,
        TranscriptionResultDto result, CancellationToken ct)
    {
        await using var lease = await gate.AcquireAsync(QuotaGateExtensions.SaveKey(job.UserId), ct);
        var now = clock.UtcNow;

        var existing = await db.Transcriptions
            .FirstOrDefaultAsync(t => t.UserId == job.UserId && t.SourceJobId == job.JobId, ct);
        if (existing is not null || job.AutoSavedAtUtc is not null)
        {
            if (job.AutoSavedAtUtc is null)
            {
                job.MarkAutoSaved(now);
                await db.SaveChangesAsync(ct);
            }
            return existing;
        }

        job.MarkAutoSaved(now);
        var owner = await db.Users.Where(u => u.Id == job.UserId).Select(u => new { u.TimeZone }).FirstOrDefaultAsync(ct);
        Transcription? sheet = null;
        if (owner is not null)
        {
            var kept = await ProStatus.IsProAsync(db, clock, job.UserId, ct) ? result : ProGate.ForFree(result);
            sheet = ToSheet(job, kept, PracticeTime.Resolve(owner.TimeZone));
            if (sheet is not null)
            {
                await KeepBackingAsync(backing, sheet, result, ct);
                db.Transcriptions.Add(sheet);
            }
        }

        await db.SaveChangesAsync(ct);
        return sheet;
    }

    /// <summary>The saved sheet for a job that finished (the server's own, or the owner's Save), or null.</summary>
    public static Task<Transcription?> FindAsync(IApplicationDbContext db, Guid userId, string jobId, CancellationToken ct)
        => db.Transcriptions.AsNoTracking()
            .FirstOrDefaultAsync(t => t.UserId == userId && t.SourceJobId == jobId, ct);

    /// <summary>A job envelope carrying the sheet it was filed as.</summary>
    public static TranscriptionJobDto WithSheet(TranscriptionJobDto dto, Transcription? sheet)
        => sheet is null ? dto : dto with { SavedId = sheet.Id, SavedTitle = sheet.Title };

    /// <summary>
    /// The sheet the result screen would have saved, marked as saved automatically; null for a result with nothing
    /// to write (no notes, no score, a key the solfa engine cannot read).
    /// </summary>
    public static Transcription? ToSheet(TranscriptionJob job, TranscriptionResultDto result, TimeZoneInfo zone)
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
            TitleFor(job, result, zone),
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
        sheet.KeepTiming(result.BeatOriginSec, result.BeatTimesSec);
        if (IsFromLink(job, result))
            sheet.MarkFromLink();
        sheet.MarkSavedAutomatically();
        return sheet;
    }

    /// <summary>A job for a pasted song link (its kind, or the song it names), as opposed to the owner's own audio.</summary>
    public static bool IsFromLink(TranscriptionJob job, TranscriptionResultDto result)
        => job.Kind == TranscriptionJobKind.Link || result.Source is not null;

    /// <summary>The largest backing kept: a ten-minute song at the worker's 48 kbps is under 4 MB.</summary>
    internal const int MaxBackingBytes = 16 * 1024 * 1024;

    /// <summary>
    /// Stores the result's backing and keeps it with <paramref name="sheet"/>, for the owner's own upload only. A
    /// backing that cannot be stored (the store is off or unreachable) is left out, never the sheet: the sheet is the job.
    /// </summary>
    private static async Task KeepBackingAsync(
        IBackingStorage backing, Transcription sheet, TranscriptionResultDto result, CancellationToken ct)
    {
        if (sheet.FromLink || string.IsNullOrEmpty(result.BackingAudioBase64))
            return;

        byte[] mp3;
        try
        {
            mp3 = Convert.FromBase64String(result.BackingAudioBase64);
        }
        catch (FormatException)
        {
            return;
        }
        if (mp3.Length == 0 || mp3.Length > MaxBackingBytes)
            return;

        var stored = await backing.SaveAsync(sheet.UserId, mp3, ct);
        if (!stored.IsSuccess)
            return;
        sheet.KeepBacking(stored.Value);

        // A sheet with a backing always keeps the beats' times, written out from the tempo it was heard at when the
        // worker tracked none: a later tempo edit changes how the notes are written, never where the recording is.
        if (sheet.BeatTimesSec is null)
            sheet.KeepTiming(result.BeatOriginSec,
                SteadyBeatTimes(result.BeatOriginSec, result.Tempo > 0 ? result.Tempo : sheet.TempoBpm, LastBeat(sheet)));
    }

    /// <summary>
    /// The audio time of beats 0 to ⌈<paramref name="lastBeat"/>⌉ + 4 at a steady <paramref name="tempoBpm"/> from
    /// <paramref name="originSec"/> (beat i at origin + i × 60 / tempo), to the millisecond.
    /// </summary>
    internal static List<double> SteadyBeatTimes(double originSec, double tempoBpm, double lastBeat)
    {
        var beats = (int)Math.Ceiling(Math.Max(0, lastBeat)) + 4;
        return [.. Enumerable.Range(0, beats + 1).Select(i => Math.Round(originSec + i * 60.0 / tempoBpm, 3))];
    }

    /// <summary>Where the sheet's last note (of the tune or any part) ends, in beats.</summary>
    private static double LastBeat(Transcription sheet)
        => sheet.Notes.Concat(sheet.Parts?.Values.SelectMany(p => p) ?? [])
            .Select(n => n.StartBeat + n.DurationBeats)
            .DefaultIfEmpty(0)
            .Max();

    /// <summary>
    /// The hymn the job recognised; else "Song — Artist" for a linked song; else when it was sent in the owner's
    /// time zone, e.g. "Recording · Sun 17:10", which tells an afternoon's takes apart in the list.
    /// </summary>
    public static string TitleFor(TranscriptionJob job, TranscriptionResultDto result, TimeZoneInfo zone)
    {
        var src = result.Source;
        var title = result.HymnMatch is { } hymn && !string.IsNullOrWhiteSpace(hymn.Title)
            ? hymn.Title.Trim()
            : src is not null && !string.IsNullOrWhiteSpace(src.Title)
                ? src.Title.Trim() + (string.IsNullOrWhiteSpace(src.Artist) ? "" : " — " + src.Artist.Trim())
                : "Recording · " + TimeZoneInfo
                    .ConvertTimeFromUtc(DateTime.SpecifyKind(job.CreatedAtUtc, DateTimeKind.Utc), zone)
                    .ToString("ddd HH:mm", CultureInfo.InvariantCulture);
        return title.Length <= 120 ? title : title[..120];
    }
}
