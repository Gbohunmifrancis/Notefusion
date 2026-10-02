using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Transcriptions;

/// <summary>
/// What a free account is handed of a finished transcription. Downloads are Pro — PDF, MusicXML and MIDI —
/// and the clients enforce that on their export buttons, but the MIDI bytes are the one export the client
/// cannot rebuild from the note list, so the API withholds them too rather than trusting a button.
/// </summary>
public static class ProGate
{
    public static TranscriptionResultDto ForFree(TranscriptionResultDto result)
        => result.MidiBase64.Length == 0 ? result : result with { MidiBase64 = string.Empty };
}
