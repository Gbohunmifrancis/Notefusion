namespace NoteFusion.Application.Blog;

/// <summary>
/// The blog's settings (<c>Blog__*</c> and <c>Gemini__Model</c>/<c>Gemini__MaxOutputTokens</c>), read by hand in
/// Infrastructure's <c>BlogDependencyInjection.ResolveSettings</c> so an empty variable takes the default.
/// </summary>
public sealed class BlogSettings
{
    public const string DefaultModel = "gemini-3.8-flash";

    /// <summary>The public site: where the catalogue is read and where posts are linked to.</summary>
    public string SiteUrl { get; init; } = "https://notefusion.studio";

    public string GeminiModel { get; init; } = DefaultModel;

    /// <summary>Thinking tokens count against it, which is why it is 16,384 rather than 8,192.</summary>
    public int GeminiMaxOutputTokens { get; init; } = 16384;

    public double GeminiTemperature { get; init; } = 0.7;

    /// <summary>A rate limit or server error is tried once more after this pause (draft.mjs waited 15 s).</summary>
    public TimeSpan GeminiRetryDelay { get; init; } = TimeSpan.FromSeconds(15);

    /// <summary>Drafts one batch on <see cref="AutoDraftDays"/> at <see cref="AutoDraftTimeUtc"/>; never publishes.</summary>
    public bool AutoDraftEnabled { get; init; } = true;

    public IReadOnlyList<DayOfWeek> AutoDraftDays { get; init; } = [DayOfWeek.Monday, DayOfWeek.Thursday];

    /// <summary>05:30 UTC is 06:30 in Lagos.</summary>
    public TimeOnly AutoDraftTimeUtc { get; init; } = new(5, 30);

    public int AutoDraftCount { get; init; } = 1;

    /// <summary>A slot missed by more than this (the API was down) is skipped rather than drafted late.</summary>
    public TimeSpan AutoDraftGrace { get; init; } = TimeSpan.FromHours(12);

    /// <summary>At most one site rebuild per this long, however many changes land.</summary>
    public TimeSpan RebuildMinInterval { get; init; } = TimeSpan.FromMinutes(2);

    /// <summary>A rebuild waits until changes have been quiet this long (a publish and a quick fix go out as one)…</summary>
    public TimeSpan RebuildQuietPeriod { get; init; } = TimeSpan.FromSeconds(20);

    /// <summary>…but never longer than this after the first change.</summary>
    public TimeSpan RebuildMaxWait { get; init; } = TimeSpan.FromMinutes(2);

    /// <summary>After a failed dispatch, the next try waits this long.</summary>
    public TimeSpan RebuildRetryDelay { get; init; } = TimeSpan.FromMinutes(2);
}
