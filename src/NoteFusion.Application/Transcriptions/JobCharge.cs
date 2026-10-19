using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Transcriptions;

/// <summary>
/// What a finished job costs, spent once whichever path sees it finish first (the client's GET or the completion push):
/// a song credit for a song (a Pro song or a free account's link preview), a free or bought transcription otherwise,
/// nothing for Pro — and nothing at all for a link whose song YouTube refused, where the store's 30-second preview stood
/// in (<see cref="StoodIn"/>). That is not the song that was asked for, so it is handed over free, as a failed job is.
/// </summary>
public static class JobCharge
{
    public static void Apply(TranscriptionJob job, TranscriptionResultDto? result, bool isPro, DateTime utcNow)
    {
        if (result is not null && StoodIn(result))
            return;
        if (job.IsSong)
        {
            // A song is its own allowance (Pro monthly songs, or the one free preview) and never a trial
            // generation: the preview exists precisely so a free account can try the feature without it
            // costing one of their recordings.
            job.ConsumeSongCredit(utcNow);
        }
        else if (!isPro)
        {
            job.ConsumeTrial(utcNow);
        }
    }

    /// <summary>YouTube refused the song and the store's 30-second preview stood in (the worker's <c>source.preview</c>).</summary>
    public static bool StoodIn(TranscriptionResultDto result) => result.Source?.Preview == true;
}
