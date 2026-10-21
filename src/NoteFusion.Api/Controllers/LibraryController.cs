using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Transcriptions.Dtos;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The user's saved-transcription library (F-08). A key change here is a pure re-label (F-03): the
/// notes never change, only the solfa the client derives from them.
/// </summary>
[Authorize]
[Route("api/library")]
public sealed class LibraryController : ApiControllerBase
{
    private readonly ISender _sender;

    public LibraryController(ISender sender) => _sender = sender;

    /// <summary>Lists the current user's saved transcriptions (without note detail).</summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetLibraryQuery(), ct));

    /// <summary>Gets one saved transcription, including its full note list.</summary>
    [HttpGet("{id:guid}", Name = nameof(GetTranscription))]
    public async Task<IActionResult> GetTranscription(Guid id, CancellationToken ct)
        => HandleResult(await _sender.Send(new GetTranscriptionQuery(id), ct));

    /// <summary>Saves a completed transcription result to the library.</summary>
    [HttpPost]
    public async Task<IActionResult> Save(SaveTranscriptionCommand command, CancellationToken ct)
    {
        var result = await _sender.Send(command, ct);
        return result.IsSuccess
            ? CreatedAtRoute(nameof(GetTranscription), new { id = result.Value.Id }, result.Value)
            : HandleResult(result);
    }

    /// <summary>Renames a saved transcription.</summary>
    [HttpPut("{id:guid}/title")]
    public async Task<IActionResult> Rename(Guid id, RenameTranscriptionBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new RenameTranscriptionCommand(id, body.Title), ct));

    /// <summary>Overrides the key (re-label only — notes are unchanged, F-03).</summary>
    [HttpPut("{id:guid}/key")]
    public async Task<IActionResult> UpdateKey(Guid id, UpdateKeyBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionKeyCommand(id, body.Key), ct));

    /// <summary>Overrides the tempo in BPM (F-07).</summary>
    [HttpPut("{id:guid}/tempo")]
    public async Task<IActionResult> UpdateTempo(Guid id, UpdateTempoBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionTempoCommand(id, body.Tempo), ct));

    /// <summary>Overrides the time signature (e.g. "4/4", "3/4", "6/8").</summary>
    [HttpPut("{id:guid}/time-signature")]
    public async Task<IActionResult> UpdateTimeSignature(Guid id, UpdateTimeSignatureBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionTimeSignatureCommand(id, body.TimeSignature), ct));

    /// <summary>
    /// Replaces the note list with the user's corrections (tap-to-correct, F-07). The whole list,
    /// because a correction can delete a note and shift every index after it.
    /// </summary>
    [HttpPut("{id:guid}/notes")]
    public async Task<IActionResult> UpdateNotes(Guid id, UpdateNotesBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionNotesCommand(id, body.Notes), ct));

    /// <summary>Sets the words under the solfa.</summary>
    [HttpPut("{id:guid}/lyrics")]
    public async Task<IActionResult> UpdateLyrics(Guid id, UpdateLyricsBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionLyricsCommand(id, body.Lyrics ?? string.Empty), ct));

    /// <summary>Files the sheet in a folder; a blank name takes it out of one.</summary>
    [HttpPut("{id:guid}/folder")]
    public async Task<IActionResult> UpdateFolder(Guid id, UpdateFolderBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionFolderCommand(id, body.Folder), ct));

    /// <summary>Renames a folder; its sheets move and its shared link keeps working.</summary>
    [HttpPut("folders")]
    public async Task<IActionResult> RenameFolder(RenameFolderCommand command, CancellationToken ct)
        => HandleNoContent(await _sender.Send(command, ct));

    /// <summary>One public link for a whole folder.</summary>
    [HttpPost("folders/share")]
    public async Task<IActionResult> ShareFolder(ShareFolderCommand command, CancellationToken ct)
    {
        var result = await _sender.Send(command, ct);
        return result.IsSuccess
            ? Ok(new ShareLinkResponse(result.Value.Token, $"https://notefusion.studio/app/sheet/?f={Uri.EscapeDataString(result.Value.Token)}"))
            : HandleResult(result);
    }

    /// <summary>Stops a folder's link.</summary>
    [HttpDelete("folders/share")]
    public async Task<IActionResult> UnshareFolder([FromQuery] string folder, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new UnshareFolderCommand(folder), ct));

    /// <summary>Attaches the four parts written for this sheet after it was saved (null removes them).</summary>
    [HttpPut("{id:guid}/parts")]
    public async Task<IActionResult> UpdateParts(Guid id, UpdatePartsBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionPartsCommand(id, body.Parts, body.PartsMusicXml), ct));

    /// <summary>
    /// Transposes for a choir's range: moves every note (melody and parts), the key and both
    /// scores by the given semitones. The solfa reads as before — only Doh moves.
    /// </summary>
    [HttpPost("{id:guid}/transpose")]
    public async Task<IActionResult> Transpose(Guid id, TransposeBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new TransposeTranscriptionCommand(id, body.Semitones), ct));

    /// <summary>Puts the sheet behind a public link (idempotent) and returns it.</summary>
    [HttpPost("{id:guid}/share")]
    public async Task<IActionResult> Share(Guid id, CancellationToken ct)
    {
        var result = await _sender.Send(new ShareTranscriptionCommand(id), ct);
        return result.IsSuccess
            ? Ok(new ShareLinkResponse(result.Value.Token, SharedSheetUrl(result.Value.Token)))
            : HandleResult(result);
    }

    /// <summary>Takes the sheet off its public link.</summary>
    [HttpDelete("{id:guid}/share")]
    public async Task<IActionResult> Unshare(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new UnshareTranscriptionCommand(id), ct));

    /// <summary>Where a shared sheet opens: the website's public sheet page.</summary>
    public static string SharedSheetUrl(string token) => $"https://notefusion.studio/app/sheet/?s={Uri.EscapeDataString(token)}";

    /// <summary>
    /// The backing kept with the sheet (the song's instrumental, from the owner's own upload), as <c>audio/mpeg</c> with
    /// range requests, for its owner only: a choir member or a shared link's reader never gets it. 404
    /// <c>BACKING_NOT_FOUND</c> for a sheet that keeps none.
    /// </summary>
    [HttpGet("{id:guid}/backing")]
    public async Task<IActionResult> GetBacking(Guid id, CancellationToken ct)
        => Backing(await _sender.Send(new GetSheetBackingQuery(id), ct));

    /// <summary>Marks a sheet opened: one saved automatically is no longer shown as unopened.</summary>
    [HttpPost("{id:guid}/opened")]
    public async Task<IActionResult> MarkOpened(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new MarkSheetOpenedCommand(id), ct));

    /// <summary>Deletes a saved transcription.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new DeleteTranscriptionCommand(id), ct));

    /// <summary>Body for a rename request (keeps the id in the route, not the payload).</summary>
    public sealed record RenameTranscriptionBody(string Title);

    /// <summary>Body for a key-override request.</summary>
    public sealed record UpdateKeyBody(string Key);

    /// <summary>Body for a tempo-override request.</summary>
    public sealed record UpdateTempoBody(int Tempo);

    /// <summary>Body for a time-signature-override request.</summary>
    public sealed record UpdateTimeSignatureBody(string TimeSignature);

    /// <summary>Body for a note-correction request.</summary>
    public sealed record UpdateNotesBody(IReadOnlyList<NoteEventDto> Notes);

    /// <summary>Body for a lyrics update.</summary>
    public sealed record UpdateLyricsBody(string? Lyrics);

    /// <summary>Body for filing a sheet: the folder's name, or blank for none.</summary>
    public sealed record UpdateFolderBody(string? Folder);

    /// <summary>Body for a parts update: the four voices and their one score, or null to remove them.</summary>
    public sealed record UpdatePartsBody(IReadOnlyDictionary<string, PartDto>? Parts, string? PartsMusicXml);

    /// <summary>Body for a transposition: −12…12 semitones.</summary>
    public sealed record TransposeBody(int Semitones);

    /// <summary>A public link: the token and the page it opens.</summary>
    public sealed record ShareLinkResponse(string Token, string Url);
}
