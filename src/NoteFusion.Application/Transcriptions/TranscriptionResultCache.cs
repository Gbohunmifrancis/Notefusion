using System.Text.Json;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.Transcriptions;

/// <summary>
/// Reads and writes the copy of a finished transcription held on <c>TranscriptionJob.ResultJson</c>.
/// One place because two callers have to agree byte-for-byte on the format: whichever of the
/// completion sweep or a client poll observes the job finish writes it, and a later poll — after the
/// ML service has forgotten the job — reads it back.
/// </summary>
public static class TranscriptionResultCache
{
    /// <summary>Camel-case, matching the wire contract, so a cached row is readable by eye.</summary>
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Serialises <paramref name="result"/> without its audio preview.
    /// </summary>
    /// <remarks>
    /// The preview is a base64 WAV the Python worker synthesises from the note list — megabytes for a
    /// long recording, and it would be stored per job forever. The client already re-synthesises the
    /// same melody locally (<c>lib/synth.ts</c>), which is exactly how it plays saved library items,
    /// so keeping the bytes here would buy nothing and cost the database a great deal.
    /// </remarks>
    public static string Serialize(TranscriptionResultDto result)
        => JsonSerializer.Serialize(result with { AudioPreviewBase64 = "", BackingAudioBase64 = "" }, Options);

    /// <summary>
    /// Reads a cached result back, or null if the stored JSON cannot be understood — a row written by
    /// an older shape of the DTO, say. Null means "fall back to whatever the ML service says", which
    /// is the behaviour that existed before the cache.
    /// </summary>
    public static TranscriptionResultDto? Deserialize(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<TranscriptionResultDto>(json, Options);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
