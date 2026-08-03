namespace NoteFusion.Core.Enums;

/// <summary>Transcription mode sent to the API (TRD §6: options.mode).</summary>
public enum TranscriptionMode
{
    /// <summary>Single line — sung/hummed melody or solo instrument.</summary>
    Melody = 0,

    /// <summary>Moderately polyphonic — e.g. solo piano.</summary>
    Polyphonic = 1
}
