namespace NoteFusion.Application.Common.Settings;

/// <summary>
/// What the app stores currently carry (section <c>AppRelease</c>). Env-driven like the rest:
/// <c>AppRelease__LatestBuild</c>, <c>AppRelease__ReleaseNotes</c>. Set on the deploy that follows a
/// store release, which is the only moment anything here changes.
/// </summary>
/// <remarks>
/// Builds, not version strings, are what the client compares — <c>"1.10.0" &lt; "1.9.0"</c> when
/// compared as text, and the build number EAS assigns is monotonic by construction. The version
/// string here is for the dialog to read out, nothing more.
/// </remarks>
public sealed class AppReleaseSettings
{
    /// <summary>Human-readable version of the newest store build, for display only.</summary>
    public string LatestVersion { get; init; } = "1.0.0";

    /// <summary>
    /// Build number of the newest store release. Clients below this are offered an update.
    /// Zero means "nothing to announce", so a deploy that forgets to set it prompts nobody.
    /// </summary>
    public int LatestBuild { get; init; }

    /// <summary>
    /// Oldest build still allowed to run. Clients below this are hard-blocked — no dismiss, no
    /// back button — so raising it is a decision to break every installed copy underneath it.
    /// </summary>
    /// <remarks>
    /// Raise it only once the replacement build is live in the store <em>and</em> propagated. Set
    /// too early it shows an undismissable dialog pointing at an update that is not there yet.
    /// Zero, the default, blocks nobody.
    /// </remarks>
    public int MinimumBuild { get; init; }

    /// <summary>What changed, shown in the update dialog. Empty is fine; the dialog omits the line.</summary>
    public string ReleaseNotes { get; init; } = "";

    /// <summary>Where the Android update button goes.</summary>
    public string AndroidStoreUrl { get; init; } =
        "https://play.google.com/store/apps/details?id=com.notefusion.com";

    /// <summary>Where the iOS update button goes. Empty until the app is listed.</summary>
    public string IosStoreUrl { get; init; } = "";

    /// <summary>
    /// How often the update-notice sweep runs. Hourly is plenty: the notice is once per device per
    /// version, so a tighter loop only re-scans rows it has already handled.
    /// </summary>
    public int NoticeIntervalMinutes { get; init; } = 60;
}
