using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Feedback;

/* ── Submitting ─────────────────────────────────────────────────────────────── */

/// <summary>
/// What the app or the web app sends: a feedback message (<c>Kind</c> "feedback", with a category and a
/// message), a rating ("rating", 1–5 stars and an optional comment), "not now" to the rating prompt
/// ("rating_dismissed"), the verdict on one transcription ("transcription", 5 spot on / 3 close / 1 off,
/// what was off as the category, an optional comment and the <c>JobId</c>), or where the user heard
/// about us ("heard_about", a source and optional detail).
/// </summary>
public sealed record SubmitFeedbackCommand(
    string Kind,
    int? Rating = null,
    string? Category = null,
    string? Message = null,
    string? Source = null,
    string? Client = null,
    string? AppVersion = null,
    string? Screen = null,
    string? JobId = null) : IRequest<Result>;

public sealed class SubmitFeedbackCommandValidator : AbstractValidator<SubmitFeedbackCommand>
{
    public SubmitFeedbackCommandValidator()
    {
        RuleFor(x => x.Kind).Must(k => k is UserFeedback.FeedbackKind or UserFeedback.RatingKind
            or UserFeedback.RatingDismissedKind or UserFeedback.HeardAboutKind or UserFeedback.TranscriptionKind)
            .WithMessage("Unknown feedback kind.");
        RuleFor(x => x.Message).NotEmpty().When(x => x.Kind == UserFeedback.FeedbackKind)
            .WithMessage("Tell us what's on your mind.");
        RuleFor(x => x.Message).MaximumLength(UserFeedback.MessageMaxLength);
        RuleFor(x => x.Rating).NotNull().InclusiveBetween(1, 5).When(x => x.Kind == UserFeedback.RatingKind);
        RuleFor(x => x.Source).NotEmpty().When(x => x.Kind == UserFeedback.HeardAboutKind);
        RuleFor(x => x.Rating).Must(r => r is not null && UserFeedback.TranscriptionVerdicts.Contains(r.Value))
            .When(x => x.Kind == UserFeedback.TranscriptionKind).WithMessage("Choose spot on, close or off.");
        RuleFor(x => x.JobId).NotEmpty().MaximumLength(UserFeedback.JobIdMaxLength)
            .When(x => x.Kind == UserFeedback.TranscriptionKind);
    }
}

public sealed class SubmitFeedbackCommandHandler : IRequestHandler<SubmitFeedbackCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IClientApp _clientApp;

    public SubmitFeedbackCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock, IClientApp clientApp)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _clientApp = clientApp;
    }

    public async Task<Result> Handle(SubmitFeedbackCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var now = _clock.UtcNow;
        var client = request.Client is "web" or "app" ? request.Client : _clientApp.Current ?? "app";

        if (request.Kind == UserFeedback.HeardAboutKind
            && await _db.UserFeedback.AnyAsync(f => f.UserId == userId && f.Kind == UserFeedback.HeardAboutKind, ct))
        {
            return Result.Success(); // answered already (two tabs, a retry): the first answer stands
        }

        if (request.Kind == UserFeedback.TranscriptionKind)
        {
            // One verdict per transcription: a changed mind ("close" then "off, the key") replaces the first.
            var earlier = await _db.UserFeedback
                .Where(f => f.UserId == userId && f.Kind == UserFeedback.TranscriptionKind && f.JobId == request.JobId)
                .ToListAsync(ct);
            _db.UserFeedback.RemoveRange(earlier);
        }

        _db.UserFeedback.Add(request.Kind switch
        {
            UserFeedback.RatingKind => UserFeedback.Rate(userId, request.Rating!.Value, request.Message, client, request.AppVersion, request.Screen, now),
            UserFeedback.RatingDismissedKind => UserFeedback.DismissRating(userId, client, request.AppVersion, request.Screen, now),
            UserFeedback.TranscriptionKind => UserFeedback.JudgeTranscription(
                userId, request.JobId!, request.Rating!.Value, request.Category, request.Message, client, request.AppVersion, now),
            UserFeedback.HeardAboutKind => UserFeedback.HeardAbout(userId, request.Source!, request.Message, client, request.AppVersion, now),
            _ => UserFeedback.Feedback(userId, request.Category, request.Message!, client, request.AppVersion, request.Screen, now)
        });
        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}

/* ── Which prompts to show ──────────────────────────────────────────────────── */

/// <summary>Whether the client should ask "where did you hear about us?" and, in the app, for a rating.</summary>
public sealed record FeedbackPromptsDto(bool AskHeardAbout, bool AskRating);

/// <summary>
/// The rules behind the prompts, decided here so the web app and every app build agree. The rating is
/// only ever asked for in the app (<paramref name="Client"/> "app").
/// </summary>
public sealed record GetFeedbackPromptsQuery(string? Client = null) : IRequest<Result<FeedbackPromptsDto>>
{
    /// <summary>Asked only once someone has seen the app work a few times.</summary>
    public const int RatingAfterTranscriptions = 3;
    /// <summary>"Not now" is respected for this long.</summary>
    public static readonly TimeSpan DismissedFor = TimeSpan.FromDays(30);
    /// <summary>A rating is asked for again after this long, in case the app changed their mind.</summary>
    public static readonly TimeSpan RatedFor = TimeSpan.FromDays(180);
}

public sealed class GetFeedbackPromptsQueryHandler : IRequestHandler<GetFeedbackPromptsQuery, Result<FeedbackPromptsDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public GetFeedbackPromptsQueryHandler(IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<FeedbackPromptsDto>> Handle(GetFeedbackPromptsQuery request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var now = _clock.UtcNow;
        var askHeardAbout = !await _db.UserFeedback.AnyAsync(f => f.UserId == userId && f.Kind == UserFeedback.HeardAboutKind, ct);

        var askRating = false;
        if (request.Client == "app")
        {
            var ratedSince = now - GetFeedbackPromptsQuery.RatedFor;
            var dismissedSince = now - GetFeedbackPromptsQuery.DismissedFor;
            var recentlyAnswered = await _db.UserFeedback.AnyAsync(f => f.UserId == userId
                && ((f.Kind == UserFeedback.RatingKind && f.CreatedAtUtc >= ratedSince)
                    || (f.Kind == UserFeedback.RatingDismissedKind && f.CreatedAtUtc >= dismissedSince)), ct);
            if (!recentlyAnswered)
            {
                var counts = await TranscriptionCounts.ForUsersAsync(_db, [userId], ct);
                askRating = counts.GetValueOrDefault(userId, UserTranscriptionCounts.None).Transcribed
                    >= GetFeedbackPromptsQuery.RatingAfterTranscriptions;
            }
        }

        return new FeedbackPromptsDto(askHeardAbout, askRating);
    }
}

/* ── The admin console ──────────────────────────────────────────────────────── */

public sealed record FeedbackRowDto(
    Guid Id, DateTime CreatedAtUtc, string Kind, int? Rating, string? Category, string? Message,
    string Client, string? AppVersion, string? Screen, Guid UserId, string? UserName, string? UserEmail,
    string? JobId = null);

/// <summary>Ratings, where people heard about us and the feedback categories, over everything recorded.</summary>
public sealed record FeedbackSummaryDto(
    double? AverageRating,
    int Ratings,
    int Dismissals,
    IReadOnlyList<CategoryCountDto> RatingDistribution,
    int HeardAboutAnswers,
    IReadOnlyList<CategoryCountDto> HeardAbout,
    int FeedbackMessages,
    IReadOnlyList<CategoryCountDto> FeedbackByCategory,
    /// <summary>Verdicts on single transcriptions, and how they split: "spot on", "close", "off".</summary>
    int TranscriptionVerdicts = 0,
    IReadOnlyList<CategoryCountDto>? TranscriptionDistribution = null,
    /// <summary>What was off, for the "close" and "off" verdicts that said.</summary>
    IReadOnlyList<CategoryCountDto>? TranscriptionIssues = null);

public sealed record GetFeedbackSummaryQuery : IRequest<Result<FeedbackSummaryDto>>;

public sealed class GetFeedbackSummaryQueryHandler : IRequestHandler<GetFeedbackSummaryQuery, Result<FeedbackSummaryDto>>
{
    private readonly IApplicationDbContext _db;

    public GetFeedbackSummaryQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<FeedbackSummaryDto>> Handle(GetFeedbackSummaryQuery request, CancellationToken ct)
    {
        var rows = await _db.RealFeedback().AsNoTracking()
            .Select(f => new { f.Kind, f.Rating, f.Category })
            .ToListAsync(ct);

        var ratings = rows.Where(r => r.Kind == UserFeedback.RatingKind && r.Rating != null).Select(r => r.Rating!.Value).ToList();
        var heard = rows.Where(r => r.Kind == UserFeedback.HeardAboutKind).ToList();
        var feedback = rows.Where(r => r.Kind == UserFeedback.FeedbackKind).ToList();
        var verdicts = rows.Where(r => r.Kind == UserFeedback.TranscriptionKind && r.Rating != null).ToList();

        static IReadOnlyList<CategoryCountDto> Ranked(IEnumerable<string?> labels) => [.. labels
            .GroupBy(l => l ?? "other")
            .Select(g => new CategoryCountDto(g.Key, g.Count()))
            .OrderByDescending(c => c.Count).ThenBy(c => c.Label, StringComparer.Ordinal)];

        return new FeedbackSummaryDto(
            ratings.Count == 0 ? null : Math.Round(ratings.Average(), 2),
            ratings.Count,
            rows.Count(r => r.Kind == UserFeedback.RatingDismissedKind),
            [.. Enumerable.Range(1, 5).Reverse().Select(s => new CategoryCountDto($"{s}", ratings.Count(r => r == s)))],
            heard.Count,
            Ranked(heard.Select(h => h.Category)),
            feedback.Count,
            Ranked(feedback.Select(f => f.Category)),
            verdicts.Count,
            [new CategoryCountDto("spot on", verdicts.Count(v => v.Rating == 5)),
             new CategoryCountDto("close", verdicts.Count(v => v.Rating == 3)),
             new CategoryCountDto("off", verdicts.Count(v => v.Rating == 1))],
            Ranked(verdicts.Where(v => v.Category != null).Select(v => v.Category)));
    }
}

/// <summary>Feedback rows newest first; <paramref name="Kind"/> narrows to one kind.</summary>
public sealed record GetFeedbackListQuery(int Page = 1, int PageSize = 25, string? Kind = null, Guid? UserId = null)
    : IRequest<Result<PagedResultDto<FeedbackRowDto>>>;

public sealed class GetFeedbackListQueryHandler : IRequestHandler<GetFeedbackListQuery, Result<PagedResultDto<FeedbackRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetFeedbackListQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PagedResultDto<FeedbackRowDto>>> Handle(GetFeedbackListQuery request, CancellationToken ct)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var query = _db.RealFeedback().AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(request.Kind))
            query = query.Where(f => f.Kind == request.Kind);
        if (request.UserId is { } userId)
            query = query.Where(f => f.UserId == userId);

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderByDescending(f => f.CreatedAtUtc).ThenBy(f => f.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(f => new FeedbackRowDto(
                f.Id, f.CreatedAtUtc, f.Kind, f.Rating, f.Category, f.Message, f.Client, f.AppVersion, f.Screen, f.UserId,
                _db.Users.Where(u => u.Id == f.UserId).Select(u => u.FullName).FirstOrDefault(),
                _db.Users.Where(u => u.Id == f.UserId).Select(u => u.Email).FirstOrDefault(),
                f.JobId))
            .ToListAsync(ct);

        return new PagedResultDto<FeedbackRowDto>(items, page, pageSize, total);
    }
}
