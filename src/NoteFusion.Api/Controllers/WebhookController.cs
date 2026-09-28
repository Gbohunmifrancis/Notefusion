using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Infrastructure.Persistence;

using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Controllers;

[ApiController]
[Route("api/internal/webhooks")]
[AllowAnonymous]
public sealed class WebhookController : ControllerBase
{
    private readonly ISender _sender;
    private readonly IApplicationDbContext _db;

    public WebhookController(ISender sender, IApplicationDbContext db)
    {
        _sender = sender;
        _db = db;
    }

    [HttpPost("transcription/{jobId}")]
    public async Task<IActionResult> TranscriptionReady(string jobId, CancellationToken ct)
    {
        var job = await _db.TranscriptionJobs.FirstOrDefaultAsync(j => j.JobId == jobId, ct);
        if (job is null)
            return NotFound();

        // Fire the command! It will poll the ML service for the actual result and push it to the user.
        var result = await _sender.Send(new NotifyTranscriptionReadyCommand(job.Id), ct);
        
        return result.IsSuccess ? Ok() : BadRequest(result.Error);
    }
}
