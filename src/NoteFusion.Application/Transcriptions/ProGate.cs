using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Transcriptions;

/// <summary>
/// What a free account is handed of a finished transcription. Downloads are Pro — PDF, MusicXML and MIDI —
/// and the clients enforce that on their export buttons, but the MIDI bytes are the one export the client
/// cannot rebuild from the note list, so the API withholds them too rather than trusting a button. The
/// four-part harmony is Pro as well: a free account sees that parts exist, not the parts.
/// </summary>
public static class ProGate
{
    public static TranscriptionResultDto ForFree(TranscriptionResultDto result)
        => result with { MidiBase64 = string.Empty, Parts = null, PartsMusicXml = string.Empty };
}
