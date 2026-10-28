namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// Who has the website open right now: a heartbeat from each tab in sight (<c>web-site/assets/track.js</c>, every minute),
/// held in memory for the Traffic page's live count and never stored. Page views and clicks alone missed a visitor reading
/// one page for minutes. One API instance holds it, as it does <see cref="IJobEvents"/>.
/// </summary>
public interface IWebPresence
{
    /// <summary>The browser <paramref name="visitorId"/> has <paramref name="path"/> in sight at <paramref name="atUtc"/>.</summary>
    void Touch(string visitorId, string path, DateTime atUtc);

    /// <summary>Every browser whose last heartbeat came at or after <paramref name="sinceUtc"/>, with the page it was on.</summary>
    IReadOnlyList<WebPresenceEntry> Since(DateTime sinceUtc);
}

public sealed record WebPresenceEntry(string VisitorId, string Path, DateTime AtUtc);
