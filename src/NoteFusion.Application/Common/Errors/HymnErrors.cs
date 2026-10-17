using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>
/// "Hum to find a hymn" (module: hymns). Every sentence is this API's own: the worker's answer and the
/// network's text go to the log, never to the visitor.
/// </summary>
public static class HymnErrors
{
    public static readonly Error NoAudio =
        Error.Validation("HYMN_NO_AUDIO", "Record a few seconds of the tune first.");

    public static readonly Error UnreadableAudio =
        Error.Validation("HYMN_UNREADABLE_AUDIO", "We couldn't read that recording. Record it again and send it.");

    public static readonly Error TooLarge =
        Error.Validation("HYMN_RECORDING_TOO_LARGE", "That recording is too long. Hum for up to 20 seconds.");

    /// <summary>The worker's look-ups are all taken (it answered 503): a moment's wait is the cure.</summary>
    public static readonly Error Busy =
        Error.Network("HYMN_FINDER_BUSY", "The hymn finder is busy right now. Try again in a few seconds.");

    public static readonly Error Unavailable =
        Error.Network("HYMN_FINDER_UNAVAILABLE", "We couldn't listen to your tune just now. Try again in a minute.");
}
