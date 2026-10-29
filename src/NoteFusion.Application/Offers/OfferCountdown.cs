namespace NoteFusion.Application.Offers;

/// <summary>
/// The last call's live countdown: an animated GIF, made when the email is opened, of the days, hours, minutes and
/// seconds left until the offer ends for that person. Mail apps play no script, so the clock is the picture: a minute of
/// frames, one a second, played once and left on the last (the time it read a minute after opening). Drawn in plain
/// pixels (a 5×7 type of our own, no fonts needed on the server) and written by a small GIF encoder, so it needs no
/// image library either.
/// </summary>
public static class OfferCountdown
{
    public const int Width = 480;
    public const int Height = 140;

    /// <summary>A minute of frames, one a second.</summary>
    public const int Frames = 60;

    /// <summary>The four colours: the night canvas, the boxes, the digits (the season's tint) and the labels.</summary>
    public sealed record Palette(int Canvas, int Box, int Digits, int Labels);

    /// <summary>Halloween's: the email header's night, pumpkin digits, moon labels.</summary>
    public static readonly Palette Halloween = new(0x0E121A, 0x1B2130, 0xF28A3A, 0xEDE6CF);

    /// <summary>Christmas's: pine digits, candle labels.</summary>
    public static readonly Palette Christmas = new(0x0E121A, 0x1B2130, 0x3DB58A, 0xF3DFB4);

    public static Palette For(string? template) => template == OfferTemplates.Christmas ? Christmas : Halloween;

    /// <summary>
    /// The countdown from <paramref name="left"/> (shown as 00:00:00:00 once it is over), one frame a second for a
    /// minute or until it reaches nothing.
    /// </summary>
    public static byte[] Render(TimeSpan left, Palette palette)
    {
        var seconds = (long)Math.Max(0, Math.Floor(left.TotalSeconds));
        var frames = new List<byte[]>();
        for (var i = 0; i < Frames && (i == 0 || seconds - i >= 0); i++)
            frames.Add(Draw(seconds - i));
        return Gif.Encode(Width, Height, palette, frames, delayCentiseconds: 100);
    }

    /// <summary>The four numbers a moment shows: days (at most 99), hours, minutes, seconds.</summary>
    public static (int Days, int Hours, int Minutes, int Seconds) Parts(long seconds)
    {
        var s = Math.Max(0, seconds);
        var days = (int)Math.Min(99, s / 86_400);
        return (days, (int)(s / 3600 % 24), (int)(s / 60 % 60), (int)(s % 60));
    }

    // ── Drawing ─────────────────────────────────────────────────────────────

    private const byte CanvasIndex = 0, BoxIndex = 1, DigitIndex = 2, LabelIndex = 3;
    private const int BoxWidth = 102, BoxHeight = 112, Gap = 16, Left = 12, Top = 14;
    private const int DigitScale = 6, LabelScale = 2;

    private static readonly string[] Labels = ["DAYS", "HOURS", "MINS", "SECS"];

    private static byte[] Draw(long secondsLeft)
    {
        var pixels = new byte[Width * Height];
        var (d, h, m, s) = Parts(secondsLeft);
        int[] values = [d, h, m, s];
        for (var box = 0; box < 4; box++)
        {
            var x = Left + box * (BoxWidth + Gap);
            Fill(pixels, x, Top, BoxWidth, BoxHeight, BoxIndex, corner: 6);
            var text = values[box].ToString("00", System.Globalization.CultureInfo.InvariantCulture);
            var digitsWidth = TextWidth(text, DigitScale);
            DrawText(pixels, text, x + (BoxWidth - digitsWidth) / 2, Top + 12, DigitScale, DigitIndex);
            var labelWidth = TextWidth(Labels[box], LabelScale);
            DrawText(pixels, Labels[box], x + (BoxWidth - labelWidth) / 2, Top + 12 + 7 * DigitScale + 16, LabelScale, LabelIndex);
        }
        return pixels;
    }

    /// <summary>A rectangle with its corners cut by <paramref name="corner"/> pixels' worth of a quarter circle.</summary>
    private static void Fill(byte[] pixels, int x, int y, int w, int h, byte index, int corner)
    {
        for (var row = 0; row < h; row++)
        {
            for (var col = 0; col < w; col++)
            {
                var cx = col < corner ? corner - col : col >= w - corner ? col - (w - corner - 1) : 0;
                var cy = row < corner ? corner - row : row >= h - corner ? row - (h - corner - 1) : 0;
                if (cx * cx + cy * cy > corner * corner)
                    continue;
                pixels[(y + row) * Width + x + col] = index;
            }
        }
    }

    private static int TextWidth(string text, int scale) => text.Length * 6 * scale - scale;

    private static void DrawText(byte[] pixels, string text, int x, int y, int scale, byte index)
    {
        foreach (var ch in text)
        {
            var glyph = Glyph(ch);
            for (var row = 0; row < 7; row++)
            {
                for (var col = 0; col < 5; col++)
                {
                    if (glyph[row][col] != '#')
                        continue;
                    for (var dy = 0; dy < scale; dy++)
                        for (var dx = 0; dx < scale; dx++)
                            pixels[(y + row * scale + dy) * Width + x + col * scale + dx] = index;
                }
            }
            x += 6 * scale;
        }
    }

    /// <summary>A 5×7 glyph: the digits and the labels' letters.</summary>
    private static string[] Glyph(char ch) => ch switch
    {
        '0' => [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
        '1' => ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
        '2' => [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
        '3' => ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
        '4' => ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
        '5' => ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
        '6' => ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
        '7' => ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
        '8' => [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
        '9' => [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
        'A' => [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
        'C' => [" ### ", "#   #", "#    ", "#    ", "#    ", "#   #", " ### "],
        'D' => ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "],
        'E' => ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
        'H' => ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"],
        'I' => [" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
        'M' => ["#   #", "## ##", "# # #", "# # #", "#   #", "#   #", "#   #"],
        'N' => ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"],
        'O' => [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
        'R' => ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
        'S' => [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "],
        'U' => ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
        'Y' => ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
        _ => ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
    };

    // ── The GIF ─────────────────────────────────────────────────────────────

    /// <summary>
    /// A GIF89a of four-colour frames. The first is whole; each after it only the rectangle that changed, drawn over the
    /// last (disposal "leave in place"), so a minute of a ticking clock stays a few kilobytes. No loop: it plays once.
    /// </summary>
    internal static class Gif
    {
        private const int MinCodeSize = 2;

        public static byte[] Encode(int width, int height, Palette palette, IReadOnlyList<byte[]> frames, int delayCentiseconds)
        {
            using var output = new MemoryStream();
            void U16(int v) { output.WriteByte((byte)(v & 0xFF)); output.WriteByte((byte)(v >> 8)); }

            output.Write("GIF89a"u8);
            U16(width);
            U16(height);
            output.WriteByte(0x91); // a global colour table of 4 entries, 2 bits of colour resolution
            output.WriteByte(0);    // background: the canvas
            output.WriteByte(0);    // square pixels
            foreach (var rgb in new[] { palette.Canvas, palette.Box, palette.Digits, palette.Labels })
            {
                output.WriteByte((byte)(rgb >> 16));
                output.WriteByte((byte)(rgb >> 8));
                output.WriteByte((byte)rgb);
            }

            byte[]? previous = null;
            foreach (var frame in frames)
            {
                var (x, y, w, h) = previous is null ? (0, 0, width, height) : Changed(previous, frame, width, height);
                previous = frame;

                // Graphic control: leave the frame in place, show it this long.
                output.Write([0x21, 0xF9, 0x04, 0x04]);
                U16(delayCentiseconds);
                output.Write([0x00, 0x00]);

                output.WriteByte(0x2C);
                U16(x);
                U16(y);
                U16(w);
                U16(h);
                output.WriteByte(0x00); // no local colour table, not interlaced

                var region = new byte[w * h];
                for (var row = 0; row < h; row++)
                    Array.Copy(frame, (y + row) * width + x, region, row * w, w);
                output.WriteByte(MinCodeSize);
                var data = Lzw(region);
                for (var at = 0; at < data.Length; at += 255)
                {
                    var length = Math.Min(255, data.Length - at);
                    output.WriteByte((byte)length);
                    output.Write(data, at, length);
                }
                output.WriteByte(0x00);
            }

            output.WriteByte(0x3B);
            return output.ToArray();
        }

        /// <summary>The smallest rectangle holding every pixel that changed (one pixel when none did).</summary>
        private static (int X, int Y, int W, int H) Changed(byte[] before, byte[] after, int width, int height)
        {
            int minX = width, minY = height, maxX = -1, maxY = -1;
            for (var i = 0; i < after.Length; i++)
            {
                if (before[i] == after[i])
                    continue;
                int x = i % width, y = i / width;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            return maxX < 0 ? (0, 0, 1, 1) : (minX, minY, maxX - minX + 1, maxY - minY + 1);
        }

        /// <summary>The GIF variant of LZW: variable-width codes from 3 bits up to 12, packed low bit first.</summary>
        internal static byte[] Lzw(byte[] indices)
        {
            var clear = 1 << MinCodeSize;
            var end = clear + 1;
            var next = end + 1;
            var codeSize = MinCodeSize + 1;
            var table = new Dictionary<int, int>();
            var bits = new BitWriter();

            bits.Write(clear, codeSize);
            int prefix = indices[0];
            for (var i = 1; i < indices.Length; i++)
            {
                var k = indices[i];
                var key = (prefix << 8) | k;
                if (table.TryGetValue(key, out var code))
                {
                    prefix = code;
                    continue;
                }
                bits.Write(prefix, codeSize);
                if (next == 4096)
                {
                    bits.Write(clear, codeSize);
                    table.Clear();
                    next = end + 1;
                    codeSize = MinCodeSize + 1;
                }
                else
                {
                    if (next >= 1 << codeSize)
                        codeSize++;
                    table[key] = next++;
                }
                prefix = k;
            }
            bits.Write(prefix, codeSize);
            bits.Write(end, codeSize);
            return bits.ToArray();
        }

        private sealed class BitWriter
        {
            private readonly List<byte> _bytes = [];
            private int _buffer;
            private int _count;

            public void Write(int code, int size)
            {
                _buffer |= code << _count;
                _count += size;
                while (_count >= 8)
                {
                    _bytes.Add((byte)(_buffer & 0xFF));
                    _buffer >>= 8;
                    _count -= 8;
                }
            }

            public byte[] ToArray()
            {
                if (_count > 0)
                    _bytes.Add((byte)(_buffer & 0xFF));
                _buffer = 0;
                _count = 0;
                return [.. _bytes];
            }
        }
    }
}
