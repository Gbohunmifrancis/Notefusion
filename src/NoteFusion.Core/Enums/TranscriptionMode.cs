namespace NoteFusion.Core.Enums;

/// <summary>
/// Transcription mode sent to the ML service (TRD §6: options.mode).
/// The string values "melody" / "poly" are part of the wire contract shared by
/// the mobile client, the C# API, and the Python worker — keep them in sync.
/// </summary>
public enum TranscriptionMode
{
    /// <summary>Single line — sung/hummed melody or solo instrument (wire value: "melody").</summary>
    Melody = 0,

    /// <summary>
    /// Moderately polyphonic — e.g. solo piano (wire value: "poly").
    /// Previously mis-named "Polyphonic", which caused ASP.NET Core's model binder to reject
    /// the form field "mode=poly" because Enum.TryParse could not match "poly" to "Polyphonic".
    /// Renamed to "Poly" so the binder resolves the value correctly.
    /// </summary>
    Poly = 1
}
