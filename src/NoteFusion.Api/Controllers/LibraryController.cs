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

    /// <summary>
    /// Replaces the note list with the user's corrections (tap-to-correct, F-07). The whole list,
    /// because a correction can delete a note and shift every index after it.
    /// </summary>
    [HttpPut("{id:guid}/notes")]
    public async Task<IActionResult> UpdateNotes(Guid id, UpdateNotesBody body, CancellationToken ct)
        => HandleResult(await _sender.Send(new UpdateTranscriptionNotesCommand(id, body.Notes), ct));

    /// <summary>Deletes a saved transcription.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        => HandleNoContent(await _sender.Send(new DeleteTranscriptionCommand(id), ct));

    /// <summary>Body for a rename request (keeps the id in the route, not the payload).</summary>
    public sealed record RenameTranscriptionBody(string Title);

    /// <summary>Body for a key-override request.</summary>
    public sealed record UpdateKeyBody(string Key);

    /// <summary>Body for a note-correction request.</summary>
    public sealed record UpdateNotesBody(IReadOnlyList<NoteEventDto> Notes);
}
