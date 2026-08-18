using NoteFusion.Application.Common.Errors;
using NoteFusion.Infrastructure.Media;
using SkiaSharp;

namespace NoteFusion.Tests.Media;

/// <summary>
/// The avatar resize. R2 stores bytes verbatim, so this is the only thing standing between an
/// arbitrary upload and what every client renders — Cloudinary used to do it on ingest.
/// </summary>
public class AvatarImageTests
{
    [Fact]
    public void Wide_image_is_cropped_square_and_scaled_to_512()
    {
        using var source = PngOf(1000, 600);

        var result = AvatarImage.ToAvatarJpeg(source);

        Assert.True(result.IsSuccess);
        using var stored = result.Value;
        using var decoded = SKBitmap.Decode(stored);
        Assert.Equal(512, decoded.Width);
        Assert.Equal(512, decoded.Height);
    }

    [Fact]
    public void Already_square_input_stays_512()
    {
        using var source = PngOf(512, 512);

        var result = AvatarImage.ToAvatarJpeg(source);

        Assert.True(result.IsSuccess);
        using var stored = result.Value;
        using var decoded = SKBitmap.Decode(stored);
        Assert.Equal(512, decoded.Width);
        Assert.Equal(512, decoded.Height);
    }

    [Fact]
    public void Bytes_that_are_not_an_image_are_rejected()
    {
        // A text file renamed .jpg passes the controller's Content-Type check, so the decoder is
        // where it has to fail.
        using var source = new MemoryStream("this is not a picture"u8.ToArray());

        var result = AvatarImage.ToAvatarJpeg(source);

        Assert.True(result.IsFailure);
        Assert.Equal(UserErrors.PictureUnsupportedType, result.Error);
    }

    private static MemoryStream PngOf(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height);
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(SKColors.Purple);

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);

        var stream = new MemoryStream();
        data.SaveTo(stream);
        stream.Position = 0;
        return stream;
    }
}
