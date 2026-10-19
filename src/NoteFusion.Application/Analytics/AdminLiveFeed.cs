using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Application.Analytics;

/// <summary>
/// The console's live notices are told when what they show changes — someone comes online or signs up, a transcription
/// or preview starts, a payment goes through — and only then ask for it (<c>GetLiveActivityQuery</c>), instead of asking
/// every fifteen seconds in every open tab. Carried on <see cref="IJobEvents"/> under its own key. The Users page
/// follows <see cref="Changed"/> too, and the Blog section's drafting cards follow <see cref="Blog"/>.
/// </summary>
public static class AdminLiveFeed
{
    /// <summary>The key the console's stream watches; not a job id.</summary>
    public const string Key = "admin:live";

    /// <summary>The event: something the live notices show has changed.</summary>
    public const string Changed = "changed";

    /// <summary>The event: a batch of blog drafts was queued, started, saved a draft or finished.</summary>
    public const string Blog = "blog";

    public static void Tell(IJobEvents events, string name = Changed) => events.Publish(Key, new JobEvent(name));
}
