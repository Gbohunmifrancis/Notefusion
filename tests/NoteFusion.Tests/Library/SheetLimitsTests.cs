using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Tests.Library;

/// <summary>
/// The library's size caps. Far above any real sheet, so a normal save is never refused; there so one
/// request cannot write megabytes into a row every library read loads. Refusals are plain sentences.
/// </summary>
public class SheetLimitsTests
{
    private static readonly NoteEventDto Note = new(60, 0, 1, 1, "d", "", 0.9);

    [Fact]
    public void A_normal_sheet_passes()
        => Assert.True(new SaveTranscriptionCommandValidator().Validate(Save()).IsValid);

    [Fact]
    public void A_score_over_two_megabytes_is_refused_with_a_plain_sentence()
    {
        var result = new SaveTranscriptionCommandValidator().Validate(Save(musicXml: Big(SheetLimits.MaxMusicXmlBytes + 1)));

        var error = Assert.Single(result.Errors);
        Assert.Equal("This score is too large to save. Try a shorter section.", error.ErrorMessage);
    }

    [Fact]
    public void A_score_of_exactly_two_megabytes_is_kept()
        => Assert.True(new SaveTranscriptionCommandValidator().Validate(Save(musicXml: Big(SheetLimits.MaxMusicXmlBytes))).IsValid);

    [Fact]
    public void Too_many_notes_are_refused_on_save_on_edit_and_on_transpose()
    {
        var notes = Notes(SheetLimits.MaxNotes + 1);

        Assert.False(new SaveTranscriptionCommandValidator().Validate(Save(notes: notes)).IsValid);
        Assert.False(new UpdateTranscriptionNotesCommandValidator()
            .Validate(new UpdateTranscriptionNotesCommand(Guid.NewGuid(), notes)).IsValid);
        Assert.False(new TransposeSheetCommandValidator()
            .Validate(new TransposeSheetCommand("C", 2, notes, "<score/>")).IsValid);

        Assert.True(new UpdateTranscriptionNotesCommandValidator()
            .Validate(new UpdateTranscriptionNotesCommand(Guid.NewGuid(), Notes(SheetLimits.MaxNotes))).IsValid);
    }

    [Fact]
    public void More_than_eight_parts_or_an_overlong_part_are_refused()
    {
        var nine = Enumerable.Range(0, SheetLimits.MaxParts + 1)
            .ToDictionary(i => $"voice{i}", _ => new PartDto([Note], []));
        var overlong = new Dictionary<string, PartDto> { ["bass"] = new(Notes(SheetLimits.MaxNotesPerPart + 1), []) };
        var satb = new Dictionary<string, PartDto> { ["s"] = new([Note], []), ["a"] = new([Note], []), ["t"] = new([Note], []), ["b"] = new([Note], []) };

        var validator = new UpdateTranscriptionPartsCommandValidator();
        Assert.False(validator.Validate(new UpdateTranscriptionPartsCommand(Guid.NewGuid(), nine, null)).IsValid);
        Assert.False(validator.Validate(new UpdateTranscriptionPartsCommand(Guid.NewGuid(), overlong, null)).IsValid);
        Assert.True(validator.Validate(new UpdateTranscriptionPartsCommand(Guid.NewGuid(), satb, "<satb/>")).IsValid);
        Assert.True(validator.Validate(new UpdateTranscriptionPartsCommand(Guid.NewGuid(), null, null)).IsValid);

        Assert.False(new SaveTranscriptionCommandValidator().Validate(Save() with { Parts = nine }).IsValid);
    }

    [Fact]
    public void An_oversized_parts_score_is_refused()
    {
        Assert.False(new UpdateTranscriptionPartsCommandValidator()
            .Validate(new UpdateTranscriptionPartsCommand(Guid.NewGuid(), null, Big(SheetLimits.MaxMusicXmlBytes + 1))).IsValid);
        Assert.False(new SaveTranscriptionCommandValidator()
            .Validate(Save() with { PartsMusicXml = Big(SheetLimits.MaxMusicXmlBytes + 1) }).IsValid);
    }

    [Fact]
    public void Lyrics_and_titles_keep_their_caps()
    {
        Assert.False(new SaveTranscriptionCommandValidator().Validate(Save() with { Lyrics = new string('a', 20_001) }).IsValid);
        Assert.False(new UpdateTranscriptionLyricsCommandValidator()
            .Validate(new UpdateTranscriptionLyricsCommand(Guid.NewGuid(), new string('a', 20_001))).IsValid);
        Assert.False(new SaveTranscriptionCommandValidator().Validate(Save() with { Title = new string('t', 201) }).IsValid);
        Assert.False(new RenameTranscriptionCommandValidator()
            .Validate(new RenameTranscriptionCommand(Guid.NewGuid(), new string('t', 201))).IsValid);
    }

    private static SaveTranscriptionCommand Save(string musicXml = "<score/>", IReadOnlyList<NoteEventDto>? notes = null)
        => new("My Song", "C", 120, "4/4", musicXml, notes ?? [Note], 0.9, "job-1");

    private static IReadOnlyList<NoteEventDto> Notes(int count)
        => Enumerable.Range(0, count).Select(i => Note with { StartBeat = i }).ToList();

    private static string Big(int bytes) => new('x', bytes);
}
