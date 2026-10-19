"""What ffmpeg may open when it reads a file that came from outside (an upload, a take, a downloaded song).

ffmpeg picks its reader from a file's content, not its name, and some readers follow addresses written inside the
file: a DASH or HLS manifest sent as "take.webm" has ffmpeg fetch every URL it names, from inside our network, and
``-protocol_whitelist file`` does not stop the DASH reader's fetches. So every such read names the containers people
actually send, and anything else is refused before ffmpeg opens it.

librosa hands a file soundfile cannot read to audioread, which runs a bare ``ffmpeg -i <file>``; importing this module
gives that call the same guard, so neither route reads a manifest.
"""

# ffmpeg demuxer names (``ffmpeg -demuxers``) for routes.ACCEPTED_SUFFIXES and what the links download: wav (and w64),
# mp3, flac, ogg (vorbis, opus), mov (mp4, m4a, 3gp), caf, matroska (webm, weba), aac (ADTS), amr, aiff and asf (wma).
FORMATS = "wav,w64,mp3,flac,ogg,mov,caf,matroska,aac,amr,amrnb,amrwb,aiff,asf"

#: Goes before ``-i`` on every ffmpeg or ffprobe that reads a file from outside.
INPUT_GUARD = ["-protocol_whitelist", "file", "-format_whitelist", FORMATS]


def guard_audioread() -> None:
    """Give audioread's ffmpeg decoder the same guard (it looks the launcher up when it runs, so this reaches it)."""
    from audioread import ffdec

    if getattr(ffdec.popen_multiple, "nf_guarded", False):
        return
    plain = ffdec.popen_multiple

    def guarded(commands, command_args, *args, **kwargs):
        if list(command_args[:1]) == ["-i"]:
            command_args = [*INPUT_GUARD, *command_args]
        return plain(commands, command_args, *args, **kwargs)

    guarded.nf_guarded = True
    ffdec.popen_multiple = guarded


guard_audioread()
