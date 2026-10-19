using System.Threading.Channels;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>A change to a transcription job, for whoever is watching it live (the job's event stream).</summary>
public sealed record JobEvent(string Name, TranscriptionJobDto? Job = null)
{
    /// <summary>The job moved: its stage, progress or place in line. Carries the job without a result.</summary>
    public const string Progress = "job";

    /// <summary>The job finished or failed; the watcher asks for the outcome.</summary>
    public const string Ended = "ended";
}

/// <summary>
/// Live job updates, in memory (one API instance, as the quota gate assumes): the worker's progress and the API's own
/// "it has ended", handed to the clients watching that job, who used to ask every two seconds instead. Nothing is kept
/// for a job nobody watches; a watcher asks for the job's state once it is subscribed (the stream's <c>ready</c>).
/// </summary>
public interface IJobEvents
{
    /// <summary>
    /// Starts watching <paramref name="jobId"/>; null when this watcher or the server holds too many already. An
    /// <paramref name="away"/> watcher (a hidden browser tab) is sent every event but is not counted as looking at the
    /// job: a tab a phone has frozen can hold a stream open without anyone seeing it, so its owner is still pushed.
    /// </summary>
    JobWatch? Watch(string jobId, string watcher, bool away = false);

    /// <summary>Whether anyone is watching the job, so a progress post nobody would see is not even read.</summary>
    bool IsWatched(string jobId);

    /// <summary>Hands the event to everyone watching the job; how many of them were not away.</summary>
    int Publish(string jobId, JobEvent jobEvent);
}

/// <summary>One watcher's events for one job, until it is disposed.</summary>
public sealed class JobWatch : IDisposable
{
    private readonly Action _end;
    private int _ended;

    public JobWatch(ChannelReader<JobEvent> events, Action end)
    {
        Events = events;
        _end = end;
    }

    public ChannelReader<JobEvent> Events { get; }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _ended, 1) == 0)
            _end();
    }
}
