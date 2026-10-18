using System.Globalization;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Common;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Shared.Results;

namespace NoteFusion.Api.Controllers;

/// <summary>Multipart body of a drill take: the recording and the drill's id from <c>GET drills/next</c>.</summary>
public sealed class GradeDrillRequest
{
    public IFormFile? Audio { get; set; }
    public string? DrillId { get; set; }

    /// <summary>
    /// Seconds of count-in before beat one ("4.5"), read in the invariant culture. Older apps send none and are graded
    /// with the two bars they play.
    /// </summary>
    public string? LeadInSec { get; set; }
}

/// <summary>JSON body of <c>PUT track</c>: "playful" or "focused".</summary>
public sealed record SetPracticeTrackRequest(string? Track);

/// <summary>
/// Practice: the free solfa drills of the practice path, and the XP, level, streak and badges every marked take earns. Days are the
/// singer's own (<c>X-Time-Zone</c>, Africa/Lagos when absent). Nothing here is earned by transcribing or bought.
/// </summary>
[Authorize]
[Route("api/practice")]
public sealed class PracticeController : ApiControllerBase
{
    /// <summary>A drill take is a few seconds; an m4a of that is tens of kilobytes, a WAV well under this.</summary>
    private const long MaxDrillTakeBytes = 8 * 1024 * 1024;

    private readonly ISender _sender;

    public PracticeController(ISender sender) => _sender = sender;

    /// <summary>
    /// The next drill on the caller's practice path (grades → units → drills): the same until a take of it is marked,
    /// then the one the path moves on to.
    /// </summary>
    [HttpGet("drills/next")]
    public async Task<IActionResult> NextDrill(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetNextDrillQuery(), ct));

    /// <summary>The old name for <c>drills/next</c>, kept for shipped apps: the same next drill.</summary>
    [HttpGet("drills/today")]
    public async Task<IActionResult> TodayDrill(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetTodayDrillQuery(), ct));

    /// <summary>
    /// Marks a sung drill note by note and records it as practice. Free for every signed-in account, a session a day
    /// (403 <c>PRACTICE_DAILY_LIMIT</c> past it); also limited per device and address (429).
    /// </summary>
    [HttpPost("drills/grade")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxDrillTakeBytes)]
    [PracticeDrillRateLimit]
    public async Task<IActionResult> GradeDrill([FromForm] GradeDrillRequest request, CancellationToken ct)
    {
        if (request.Audio is null || request.Audio.Length == 0)
            return HandleResult(Result.Failure<GradeResultDto>(Application.Common.Errors.PracticeErrors.NoTake));
        double? leadIn = null;
        if (!string.IsNullOrWhiteSpace(request.LeadInSec))
        {
            if (!double.TryParse(request.LeadInSec, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds))
                return HandleResult(Result.Failure<GradeResultDto>(Application.Common.Errors.PracticeErrors.LeadIn));
            leadIn = seconds;
        }

        await using var stream = request.Audio.OpenReadStream();
        return HandleResult(await _sender.Send(new GradeDrillCommand(stream, request.Audio.FileName, request.DrillId ?? string.Empty, leadIn), ct));
    }

    /// <summary>XP, level, streak, weekly goal, badges, the last seven days, and the track (null until chosen).</summary>
    [HttpGet("progress")]
    public async Task<IActionResult> Progress(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPracticeProgressQuery(), ct));

    /// <summary>
    /// Sets how the caller likes to practise: <c>{"track":"playful"}</c> or <c>{"track":"focused"}</c> (422
    /// <c>PRACTICE_TRACK_UNKNOWN</c> otherwise). Answers with the progress; today's drill becomes the track's own.
    /// </summary>
    [HttpPut("track")]
    public async Task<IActionResult> SetTrack(SetPracticeTrackRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SetPracticeTrackCommand(body.Track), ct));

    /// <summary>
    /// The caller's practice reminders (sent to their phones): <c>{enabled, hour, sound}</c>. On by default once
    /// they have practised or chosen a track; the hour is local (8–21, 19 by default).
    /// </summary>
    [HttpGet("reminders")]
    public async Task<IActionResult> Reminders(CancellationToken ct)
        => HandleResult(await _sender.Send(new GetPracticeRemindersQuery(), ct));

    /// <summary>
    /// Changes any of <c>enabled</c>, <c>hour</c> (8–21; 422 <c>PRACTICE_REMINDER_HOUR</c> otherwise) and <c>sound</c>,
    /// leaving the rest. Answers with the reminders as they now stand.
    /// </summary>
    [HttpPut("reminders")]
    public async Task<IActionResult> SetReminders(SetPracticeRemindersRequest body, CancellationToken ct)
        => HandleResult(await _sender.Send(new SetPracticeRemindersCommand(body.Enabled, body.Hour, body.Sound), ct));
}

/// <summary>JSON body of <c>PUT reminders</c>: any of the three; what is left out stays as it is.</summary>
public sealed record SetPracticeRemindersRequest(bool? Enabled, int? Hour, bool? Sound);
