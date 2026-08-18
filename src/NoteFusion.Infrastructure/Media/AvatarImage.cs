using NoteFusion.Application.Common.Errors;
using NoteFusion.Shared.Results;
using SkiaSharp;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// Normalises an uploaded picture into the one avatar we store. R2 is pure object storage with no
/// transformation of any kind, so the crop-and-scale Cloudinary used to do on ingest happens here.
/// </summary>
internal static class AvatarImage
{
    /// <summary>
    /// Square and capped well under the 500-character URL column: the stored object is already the
    /// avatar, so the app renders the URL as-is with no delivery transform to get wrong.
    /// </summary>
    private const int AvatarSize = 512;

    /// <summary>Visually lossless at this size, and keeps the object small enough to cache cheaply.</summary>
    private const int JpegQuality = 80;

    /// <summary>
    /// Decodes <paramref name="source"/>, centre-crops it to a square, scales that to 512×512 and
    /// re-encodes as JPEG. The returned stream is positioned at 0 and owned by the caller.
    /// </summary>
    /// <remarks>
    /// Centre-crop rather than stretch. <c>mobile/src/lib/imagePicker.ts</c> already crops square
    /// before uploading, so for our own client this is a no-op — but a direct API call or an older
    /// build must not produce a squashed avatar.
    /// <para>
    /// Face-aware cropping is genuinely lost in the move off Cloudinary; there is no local face
    /// detector. The client's manual crop replaces it, and arguably improves on it, since the user
    /// chooses the framing.
    /// </para>
    /// </remarks>
    internal static Result<MemoryStream> ToAvatarJpeg(Stream source)
    {
        // Decode is the real format check: bytes that aren't an image fail here regardless of the
        // Content-Type the client declared, which is the one thing the controller cannot verify.
        using var decoded = SKBitmap.Decode(source);
        if (decoded is null || decoded.Width == 0 || decoded.Height == 0)
        {
            return UserErrors.PictureUnsupportedType;
        }

        var edge = Math.Min(decoded.Width, decoded.Height);
        var crop = SKRectI.Create((decoded.Width - edge) / 2, (decoded.Height - edge) / 2, edge, edge);

        using var square = new SKBitmap(edge, edge);
        if (!decoded.ExtractSubset(square, crop))
        {
            return UserErrors.PictureUnsupportedType;
        }

        using var resized = square.Resize(new SKImageInfo(AvatarSize, AvatarSize), SKSamplingOptions.Default);
        if (resized is null)
        {
            return UserErrors.PictureUnsupportedType;
        }

        using var image = SKImage.FromBitmap(resized);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, JpegQuality);

        var output = new MemoryStream();
        data.SaveTo(output);
        output.Position = 0;
        return output;
    }
}
