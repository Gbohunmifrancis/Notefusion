using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Application.WebPreview;

internal static class WebPreviewResultProjection
{
    public static WebPreviewResultDto From(TranscriptionResultDto result)
        => new(
            result.Key,
            result.KeyConfidence,
            result.Tempo,
            result.TimeSignature,
            result.Notes,
            result.SolfaLines,
            result.OverallConfidence,
            result.PitchRefined,
            result.ChromaticSpelling);
}
