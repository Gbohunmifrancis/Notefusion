namespace NoteFusion.Core.Enums;

/// <summary>
/// What a transcription job was made from. An upload is a recording the user made or picked; a link is a
/// song fetched from a streaming platform; a song is an uploaded recording of a whole song that the voice
/// is isolated from first. Links and songs are metered together (song credits) because each costs the
/// worker a vocal-isolation pass over minutes of audio that a hummed clip does not.
/// </summary>
public enum TranscriptionJobKind
{
    Upload = 0,
    Link = 1,
    Song = 2
}
