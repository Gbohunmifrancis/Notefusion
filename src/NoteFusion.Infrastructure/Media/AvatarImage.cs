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
    /// The largest picture decoded, in pixels: 40 MP, room for the square crop the app takes of a 48 MP
    /// phone photo (about 37 MP), and 160 MB of pixels at most once decoded.
    /// </summary>
    internal const long MaxPixels = 40_000_000;

    /// <summary>
    /// Decodes <paramref name="source"/>, turns it upright, centre-crops it to a square, scales that to
    /// 512×512 and re-encodes as JPEG on white. The returned stream is positioned at 0 and owned by
    /// the caller.
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
        using var codec = SKCodec.Create(source);

        // The header's size, read before a pixel is decoded. A few kilobytes of PNG can declare a picture of
        // hundreds of megapixels, and decoding it would allocate four bytes for each — one upload, one
        // exhausted server.
        if (codec is not null && (long)codec.Info.Width * codec.Info.Height > MaxPixels)
        {
            return UserErrors.PictureUnsupportedType;
        }

        using var stored = codec is null ? null : SKBitmap.Decode(codec);
        if (codec is null || stored is null || stored.Width == 0 || stored.Height == 0)
        {
            return UserErrors.PictureUnsupportedType;
        }

        // Phones save the sensor's pixels as read and note which way up they go in EXIF, which a plain
        // decode ignores — that is how a portrait photo came out lying on its side. Turned before the
        // crop, so the square is taken from the picture the user actually sees.
        using var turned = Upright(stored, codec.EncodedOrigin);
        var decoded = turned ?? stored;

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

        // JPEG has no alpha channel, so the transparent parts of a PNG or WebP would encode as black.
        // Flatten onto white first, which is how the picture looked on any page the user saw it on.
        using var flattened = new SKBitmap(AvatarSize, AvatarSize);
        using (var canvas = new SKCanvas(flattened))
        {
            canvas.Clear(SKColors.White);
            canvas.DrawBitmap(resized, 0, 0, SKSamplingOptions.Default);
        }

        using var image = SKImage.FromBitmap(flattened);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, JpegQuality);

        var output = new MemoryStream();
        data.SaveTo(output);
        output.Position = 0;
        return output;
    }

    /// <summary>
    /// <paramref name="stored"/> turned the way its EXIF <paramref name="origin"/> says it is meant to
    /// be seen, or null when it already is (the common case, which then costs no copy).
    /// </summary>
    internal static SKBitmap? Upright(SKBitmap stored, SKEncodedOrigin origin)
    {
        float w = stored.Width, h = stored.Height;

        // Skia's own SkEncodedOriginToMatrix: where each stored pixel lands on the displayed picture.
        SKMatrix? toDisplay = origin switch
        {
            SKEncodedOrigin.TopRight => new SKMatrix(-1, 0, w, 0, 1, 0, 0, 0, 1),
            SKEncodedOrigin.BottomRight => new SKMatrix(-1, 0, w, 0, -1, h, 0, 0, 1),
            SKEncodedOrigin.BottomLeft => new SKMatrix(1, 0, 0, 0, -1, h, 0, 0, 1),
            SKEncodedOrigin.LeftTop => new SKMatrix(0, 1, 0, 1, 0, 0, 0, 0, 1),
            SKEncodedOrigin.RightTop => new SKMatrix(0, -1, h, 1, 0, 0, 0, 0, 1),
            SKEncodedOrigin.RightBottom => new SKMatrix(0, -1, h, -1, 0, w, 0, 0, 1),
            SKEncodedOrigin.LeftBottom => new SKMatrix(0, 1, 0, -1, 0, w, 0, 0, 1),
            _ => null,
        };
        if (toDisplay is not { } matrix)
        {
            return null;
        }

        // The quarter turns (and their mirror images) swap width and height.
        var swaps = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var upright = new SKBitmap(swaps ? stored.Height : stored.Width, swaps ? stored.Width : stored.Height);

        using var canvas = new SKCanvas(upright);
        canvas.Clear();
        canvas.SetMatrix(matrix);
        canvas.DrawBitmap(stored, 0, 0, SKSamplingOptions.Default);
        return upright;
    }
}
