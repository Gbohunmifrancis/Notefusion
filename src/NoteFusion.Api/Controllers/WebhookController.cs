using System.Security.Cryptography;
using System.Text;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Infrastructure.Persistence;

using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Api.Controllers;

/// <summary>
/// The ML worker's completion callback. Anonymous to the JWT scheme — the worker has no user — but not
/// open: it must present the same <c>X-Api-Key</c> this API sends the worker (<c>TranscriptionApi__ApiKey</c>).
/// With no key configured (a local stack) the check is off, as it is on the worker's side.
/// </summary>
[ApiController]
[Route("api/internal/webhooks")]
[AllowAnonymous]
public sealed class WebhookController : ControllerBase
{
    private const string ApiKeyHeader = "X-Api-Key";

    private readonly ISender _sender;
    private readonly IApplicationDbContext _db;
    private readonly IConfiguration _config;
    private readonly IWebHostEnvironment _env;

    public WebhookController(ISender sender, IApplicationDbContext db, IConfiguration config, IWebHostEnvironment env)
    {
        _sender = sender;
        _db = db;
        _config = config;
        _env = env;
    }

    [HttpPost("transcription/{jobId}")]
    public async Task<IActionResult> TranscriptionReady(string jobId, CancellationToken ct)
    {
        if (!IsAuthorised(_config["TranscriptionApi:ApiKey"], Request.Headers[ApiKeyHeader].ToString(), _env.IsDevelopment()))
            return Unauthorized();

        var job = await _db.TranscriptionJobs.FirstOrDefaultAsync(j => j.JobId == jobId, ct);
        if (job is null)
        {
            // A website preview has no account job row. It used to be answered 404 here, so a preview whose
            // visitor had closed the tab was never recorded as finished and showed as running for good.
            var previewId = await _db.PreviewJobs.Where(p => p.JobId == jobId).Select(p => (Guid?)p.Id).FirstOrDefaultAsync(ct);
            if (previewId is null)
                return NotFound();
            var settled = await _sender.Send(new SettlePreviewJobCommand(previewId.Value), ct);
            return settled.IsSuccess ? Ok() : BadRequest(settled.Error);
        }

        // Fire the command! It will poll the ML service for the actual result and push it to the user.
        var result = await _sender.Send(new NotifyTranscriptionReadyCommand(job.Id), ct);

        return result.IsSuccess ? Ok() : BadRequest(result.Error);
    }

    /// <summary>
    /// True when <paramref name="presented"/> is the configured key, or when no key is configured on a
    /// development machine. Outside Development a missing key refuses everyone rather than letting anyone in.
    /// Compared in constant time so the answer's timing does not give the key away a character at a time.
    /// </summary>
    internal static bool IsAuthorised(string? configured, string? presented, bool development)
    {
        if (string.IsNullOrEmpty(configured))
            return development;

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(configured),
            Encoding.UTF8.GetBytes(presented ?? string.Empty));
    }
}
