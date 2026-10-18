using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The worker's practice graders (<c>server/app/api/practice.py</c> and <c>/v1/grade</c>): synchronous, a short take
/// each, answered in seconds. The worker deletes the take; the API records what it marked. Failures are the same
/// plain sentences as <see cref="ITranscriptionApi.GradeAsync"/>'s.
/// </summary>
public interface IPracticeAudioApi
{
    /// <summary>
    /// POST /v1/grade — the take marked note by note, as <see cref="ITranscriptionApi.GradeAsync"/> marks one, cut at
    /// <paramref name="maxTakeSeconds"/>. <paramref name="offsetSearchSeconds"/> narrows how far the worker looks to line
    /// the take up (pitch match: its reference tones sit between the notes); null keeps the grader's own 1.5 s.
    /// </summary>
    Task<Result<GradeResultDto>> GradeNotesAsync(
        Stream audio,
        string fileName,
        GradeTargetDto target,
        double maxTakeSeconds,
        double? offsetSearchSeconds = null,
        CancellationToken cancellationToken = default);

    /// <summary>POST /v1/grade/run — a full-speed run marked on its shape (the notes in order) and its landing note.</summary>
    Task<Result<RunGradeDto>> GradeRunAsync(
        Stream audio,
        string fileName,
        GradeTargetDto target,
        double maxTakeSeconds,
        CancellationToken cancellationToken = default);

    /// <summary>POST /v1/grade/rhythm — claps found in the take and marked against each clap's beat.</summary>
    Task<Result<RhythmGradeDto>> GradeRhythmAsync(
        Stream audio,
        string fileName,
        IReadOnlyList<double> beats,
        double tempoBpm,
        double leadInSec,
        double maxTakeSeconds,
        CancellationToken cancellationToken = default);

    /// <summary>POST /v1/range — the notes held in a take, and the lowest and highest of them (null when none was held).</summary>
    Task<Result<RangeReadingDto>> ReadRangeAsync(
        Stream audio,
        string fileName,
        CancellationToken cancellationToken = default);
}

/// <summary>A note held in a range take: the nearest note, the cents off it, and how long it was held.</summary>
public sealed record HeldNoteReading(int Midi, double Cents, double Seconds);

/// <summary>What the range finder heard in one take: its lowest and highest held notes, null when nothing was held.</summary>
public sealed record RangeReadingDto(HeldNoteReading? Lowest, HeldNoteReading? Highest, int Holds, double SecondsHeard);
