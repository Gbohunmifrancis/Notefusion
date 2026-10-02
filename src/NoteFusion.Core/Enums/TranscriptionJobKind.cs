namespace NoteFusion.Core.Enums;

/// <summary>
/// What a transcription job was made from. An upload is a recording the user made or picked; a link is a
/// song fetched from a streaming platform, which is metered separately (song credits) because it costs
/// the worker a download and a vocal-isolation pass that a hummed clip does not.
/// </summary>
public enum TranscriptionJobKind
{
    Upload = 0,
    Link = 1
}
