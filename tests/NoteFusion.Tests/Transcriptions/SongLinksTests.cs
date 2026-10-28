using NoteFusion.Application.Transcriptions;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The one rule for finding a song link in pasted text, mirrored from the worker's <c>extract_url</c> and
/// <c>provider_of</c>: the first http(s) link, trailing punctuation trimmed, on a supported service. Real
/// share-sheet text is the point — the apps wrap the link in words and users paste the lot.
/// </summary>
public class SongLinksTests
{
    [Theory]
    // YouTube: every host and path shape a share produces.
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")]
    [InlineData("https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=AbC")]
    [InlineData("https://youtube.com/shorts/dQw4w9WgXcQ?si=x")]
    [InlineData("https://www.youtube.com/live/dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/embed/dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/1k8craCGpgs?si=Xy12AbCdEfGhIjKl")]
    [InlineData("http://youtu.be/dQw4w9WgXcQ")]
    // Spotify: tracks, regional paths, short links.
    [InlineData("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")]
    [InlineData("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=a1b2c3")]
    [InlineData("https://open.spotify.com/intl-fr/track/4cOdK2wGLETKBW3PvgPWqT")]
    [InlineData("https://open.spotify.com/intl-pt-BR/track/4cOdK2wGLETKBW3PvgPWqT")]
    [InlineData("https://spotify.link/qKr2CFxMQwb")]
    [InlineData("https://spotify.app.link/qKr2CFxMQwb")]
    // Apple Music: album links with the song's i= anywhere, song links, the geo host.
    [InlineData("https://music.apple.com/us/album/never-gonna-give-you-up/1559885421?i=1559885424")]
    [InlineData("https://music.apple.com/ng/album/x/123?ls=1&i=456")]
    [InlineData("https://music.apple.com/us/album/dont-stop-believin-2022-remaster/1640102583?i=1640102584")]
    [InlineData("https://music.apple.com/gb/song/never-gonna-give-you-up/1559885424")]
    [InlineData("https://music.apple.com/gb/song/1559885424")]
    [InlineData("https://geo.music.apple.com/us/album/_/1559885421?i=1559885424")]
    // Instagram reels and posts, TikTok videos and their short links.
    [InlineData("https://www.instagram.com/reel/C9xYz12AbCd/?igsh=abc")]
    [InlineData("https://instagram.com/reels/C9xYz12AbCd/")]
    [InlineData("https://www.instagram.com/p/C9xYz12AbCd/")]
    [InlineData("https://www.instagram.com/someone/reel/C9xYz12AbCd/")]
    [InlineData("https://www.tiktok.com/@singer/video/7312345678901234567?is_from_webapp=1")]
    [InlineData("https://vm.tiktok.com/ZMabc123/")]
    [InlineData("https://vt.tiktok.com/ZSabc123/")]
    [InlineData("https://www.tiktok.com/t/ZTabc123/")]
    [InlineData("https://m.tiktok.com/v/7312345678901234567.html")]
    public void A_supported_song_link_is_taken_as_it_is(string link)
    {
        Assert.True(SongLinks.TryExtract(link, out var url));
        Assert.Equal(link, url);
    }

    [Theory]
    [InlineData("Listen to Never Gonna Give You Up on Spotify: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc",
        "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc")]
    [InlineData("Check this out https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ.", "https://youtu.be/dQw4w9WgXcQ")]
    [InlineData("(https://youtu.be/dQw4w9WgXcQ)", "https://youtu.be/dQw4w9WgXcQ")]
    [InlineData("Sing this one: \"https://music.apple.com/ng/song/1559885424\"!", "https://music.apple.com/ng/song/1559885424")]
    [InlineData("  https://www.youtube.com/watch?v=dQw4w9WgXcQ  \n", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("first https://youtu.be/dQw4w9WgXcQ then https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
        "https://youtu.be/dQw4w9WgXcQ")]
    [InlineData("HTTPS://YOUTU.BE/dQw4w9WgXcQ", "HTTPS://YOUTU.BE/dQw4w9WgXcQ")]
    public void Only_the_first_link_in_share_text_is_kept_without_its_punctuation(string text, string expected)
    {
        Assert.True(SongLinks.TryExtract(text, out var url));
        Assert.Equal(expected, url);
    }

    [Theory]
    [InlineData("youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("Sing this: m.youtube.com/watch?v=dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("youtu.be/dQw4w9WgXcQ.", "https://youtu.be/dQw4w9WgXcQ")]
    [InlineData("open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT", "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")]
    [InlineData("(music.apple.com/gb/song/1559885424)", "https://music.apple.com/gb/song/1559885424")]
    [InlineData("instagram.com/reel/C9xYz12AbCd", "https://instagram.com/reel/C9xYz12AbCd")]
    [InlineData("Watch this vm.tiktok.com/ZMabc123/", "https://vm.tiktok.com/ZMabc123/")]
    public void A_link_typed_without_its_scheme_is_read_as_https(string text, string expected)
    {
        Assert.True(SongLinks.TryExtract(text, out var url));
        Assert.Equal(expected, url);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not a link")]
    [InlineData("notyoutube.com/watch?v=dQw4w9WgXcQ")]                    // no scheme, and not YouTube
    [InlineData("example.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("youtube.com/@RickAstleyYT")]                             // no scheme, a channel
    [InlineData("ftp://example.com/song")]
    [InlineData("https://")]
    [InlineData("https://example.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/@RickAstleyYT")]                 // a channel
    [InlineData("https://www.youtube.com/playlist?list=PL1234567890")]   // a playlist
    [InlineData("https://www.youtube.com/watch?v=short")]                 // not an 11-character id
    [InlineData("https://youtu.be/")]
    [InlineData("https://notyoutube.com/watch?v=dQw4w9WgXcQ")]
    [InlineData("https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT")]
    [InlineData("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")]
    [InlineData("https://spotify.link/")]
    [InlineData("https://music.apple.com/us/album/never-gonna-give-you-up/1559885421")] // a whole album
    [InlineData("https://music.apple.com/us/artist/rick-astley/669771")]
    [InlineData("https://music.apple.com/us/song/never-gonna-give-you-up/abc")]
    [InlineData("https://www.instagram.com/someone/")]                  // a profile
    [InlineData("https://www.instagram.com/explore/tags/choir/")]
    [InlineData("https://www.tiktok.com/@singer")]                       // a profile
    [InlineData("https://www.tiktok.com/music/original-sound-7312345678901234567")]
    [InlineData("https://vm.tiktok.com/")]
    [InlineData("Check this out, it's on YouTube")]
    public void Anything_else_is_refused(string? text)
    {
        Assert.False(SongLinks.TryExtract(text, out var url));
        Assert.Equal(string.Empty, url);
    }

    [Fact]
    public void A_link_longer_than_any_share_link_is_refused()
    {
        var huge = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&pad=" + new string('x', SongLinks.MaxLength);

        Assert.False(SongLinks.TryExtract(huge, out _));
    }
}
