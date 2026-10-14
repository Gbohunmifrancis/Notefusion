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

    [Fact]
    public void Transparent_areas_come_out_white_not_black()
    {
        // JPEG has no alpha: left as it was, a transparent PNG logo became a black square.
        using var source = PngOf(600, 600, SKColors.Transparent);

        var result = AvatarImage.ToAvatarJpeg(source);

        Assert.True(result.IsSuccess);
        using var stored = result.Value;
        using var decoded = SKBitmap.Decode(stored);
        var corner = decoded.GetPixel(4, 4);
        Assert.True(corner is { Red: > 245, Green: > 245, Blue: > 245 }, $"corner was {corner}");
    }

    [Fact]
    public void A_phone_photo_is_turned_the_way_its_exif_says_before_cropping()
    {
        // Stored landscape, red on top, with orientation 6 ("turn 90° clockwise to view"), as a phone
        // held upright writes it. Seen upright, red is the right half — ignored, red was the top.
        using var source = JpegWithOrientation6();

        var result = AvatarImage.ToAvatarJpeg(source);

        Assert.True(result.IsSuccess);
        using var stored = result.Value;
        using var decoded = SKBitmap.Decode(stored);
        var topLeft = decoded.GetPixel(100, 128);
        var bottomRight = decoded.GetPixel(412, 384);
        Assert.True(topLeft is { Blue: > 200, Red: < 60 }, $"top-left was {topLeft}");
        Assert.True(bottomRight is { Red: > 200, Blue: < 60 }, $"bottom-right was {bottomRight}");
    }

    [Fact]
    public void A_quarter_turn_swaps_width_and_height_and_moves_the_top_edge_to_the_right()
    {
        using var stored = new SKBitmap(4, 2);
        stored.Erase(SKColors.Blue);
        stored.SetPixel(0, 0, SKColors.Red);

        using var upright = AvatarImage.Upright(stored, SKEncodedOrigin.RightTop);

        Assert.NotNull(upright);
        Assert.Equal(2, upright.Width);
        Assert.Equal(4, upright.Height);
        Assert.Equal(SKColors.Red, upright.GetPixel(1, 0));
    }

    [Fact]
    public void An_already_upright_picture_is_not_copied()
    {
        using var stored = new SKBitmap(4, 2);

        Assert.Null(AvatarImage.Upright(stored, SKEncodedOrigin.TopLeft));
    }

    /// <summary>A 400×200 JPEG, top half red and bottom half blue, tagged EXIF orientation 6.</summary>
    private static MemoryStream JpegWithOrientation6()
    {
        using var bitmap = new SKBitmap(400, 200);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.Blue);
            using var red = new SKPaint { Color = SKColors.Red };
            canvas.DrawRect(0, 0, 400, 100, red);
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, 95);
        var jpeg = data.ToArray();

        // APP1 "Exif": a big-endian TIFF header and one IFD entry — tag 0x0112 (Orientation), SHORT, 6.
        byte[] app1 =
        [
            0xFF, 0xE1, 0x00, 0x22,
            (byte)'E', (byte)'x', (byte)'i', (byte)'f', 0x00, 0x00,
            (byte)'M', (byte)'M', 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
            0x00, 0x01,
            0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ];

        // Straight after the SOI marker, where cameras put it.
        return new MemoryStream([.. jpeg[..2], .. app1, .. jpeg[2..]]);
    }

    [Fact]
    public void A_header_declaring_a_huge_picture_is_rejected_before_decoding()
    {
        // A real 8x8 PNG whose header has been rewritten to claim 10000x10000 (100 MP): a few hundred bytes
        // that would ask the decoder for 400 MB.
        using var small = PngOf(8, 8);
        var bytes = small.ToArray();
        WriteBigEndian(bytes, 16, 10_000);
        WriteBigEndian(bytes, 20, 10_000);
        WriteBigEndian(bytes, 29, Crc32(bytes.AsSpan(12, 17))); // IHDR type + data, so the header still reads

        using var codec = SKCodec.Create(new MemoryStream(bytes));
        Assert.NotNull(codec); // the forged header is accepted by the codec; it is the cap that refuses it
        Assert.Equal(10_000, codec.Info.Width);

        var result = AvatarImage.ToAvatarJpeg(new MemoryStream(bytes));

        Assert.True(result.IsFailure);
        Assert.Equal(UserErrors.PictureUnsupportedType, result.Error);
    }

    private static void WriteBigEndian(byte[] buffer, int offset, uint value)
    {
        buffer[offset] = (byte)(value >> 24);
        buffer[offset + 1] = (byte)(value >> 16);
        buffer[offset + 2] = (byte)(value >> 8);
        buffer[offset + 3] = (byte)value;
    }

    private static uint Crc32(ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data)
        {
            crc ^= b;
            for (var k = 0; k < 8; k++)
                crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }

    private static MemoryStream PngOf(int width, int height, SKColor? fill = null)
    {
        using var bitmap = new SKBitmap(width, height);
        using var canvas = new SKCanvas(bitmap);
        canvas.Clear(fill ?? SKColors.Purple);

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);

        var stream = new MemoryStream();
        data.SaveTo(stream);
        stream.Position = 0;
        return stream;
    }
}
