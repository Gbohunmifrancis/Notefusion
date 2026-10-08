using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Activity.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Activity.Queries;

/// <summary>
/// The full user activity feed behind the overview's "Recent activity" panel, newest first and paged:
/// sign-ups, latest sign-ins, every transcription asked for, saved sheets, payments, and the actions
/// signed-in web users take. <paramref name="Kind"/> narrows it to one of <see cref="Kinds"/>.
/// </summary>
/// <remarks>
/// The sources are separate tables, so each is read newest-first up to the end of the requested page
/// and the merge is paged in memory. That is exact for the order and bounded by <see cref="MaxDepth"/>
/// rows per source, far past how deep anyone pages a feed.
/// </remarks>
public sealed record GetActivityFeedQuery(int Page = 1, int PageSize = 30, string? Kind = null)
    : IRequest<Result<PagedResultDto<FeedItemDto>>>
{
    public const int MaxPageSize = 100;
    public const int MaxDepth = 3000;
    public static readonly string[] Kinds = ["signup", "login", "transcription", "saved", "payment", "action"];
}

public sealed class GetActivityFeedQueryHandler : IRequestHandler<GetActivityFeedQuery, Result<PagedResultDto<FeedItemDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetActivityFeedQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PagedResultDto<FeedItemDto>>> Handle(GetActivityFeedQuery request, CancellationToken ct)
    {
        var pageSize = Math.Clamp(request.PageSize, 1, GetActivityFeedQuery.MaxPageSize);
        var page = Math.Clamp(request.Page, 1, Math.Max(1, GetActivityFeedQuery.MaxDepth / pageSize));
        var depth = page * pageSize;
        bool Wants(string kind) => string.IsNullOrWhiteSpace(request.Kind) || request.Kind == kind;

        var rows = new List<(DateTime At, string Kind, Guid? UserId, string Title, string? Detail, string Tone)>();
        var total = 0;

        if (Wants("signup"))
        {
            total += await _db.Users.CountAsync(ct);
            rows.AddRange((await _db.Users.AsNoTracking().OrderByDescending(u => u.CreatedAt).Take(depth)
                    .Select(u => new { u.CreatedAt, u.Id, u.SignupSource }).ToListAsync(ct))
                .Select(u => (u.CreatedAt, "signup", (Guid?)u.Id, "Signed up",
                    u.SignupSource == null ? null : $"from the {u.SignupSource}", "ok")));
        }

        if (Wants("login"))
        {
            // The schema keeps each account's latest sign-in only, so an account appears here once.
            total += await _db.Users.CountAsync(u => u.LastLoginAt != null, ct);
            rows.AddRange((await _db.Users.AsNoTracking().Where(u => u.LastLoginAt != null).OrderByDescending(u => u.LastLoginAt).Take(depth)
                    .Select(u => new { At = u.LastLoginAt!.Value, u.Id }).ToListAsync(ct))
                .Select(u => (u.At, "login", (Guid?)u.Id, "Signed in (latest)", (string?)null, "ok")));
        }

        if (Wants("transcription"))
        {
            total += await _db.TranscriptionLogs.CountAsync(ct);
            rows.AddRange((await _db.TranscriptionLogs.AsNoTracking().OrderByDescending(l => l.CreatedAtUtc).Take(depth).ToListAsync(ct))
                .Select(l => (l.CreatedAtUtc, "transcription", l.UserId,
                    (l.Origin == TranscriptionLog.PreviewOrigin ? "Free preview: " : "Transcribed ")
                        + (l.Kind == "link" ? l.SongTitle ?? l.LinkUrl ?? "a song link" : l.FileName ?? "a recording"),
                    (string?)(l.Status switch
                    {
                        TranscriptionLog.Done => l.DetectedKey is null ? "done" : $"done · {l.DetectedKey}, {l.DetectedTempo} BPM",
                        TranscriptionLog.Failed => $"failed · {l.FailureReason}",
                        TranscriptionLog.Refused => $"refused · {l.FailureReason}",
                        _ => "in progress"
                    }),
                    l.Status is TranscriptionLog.Failed or TranscriptionLog.Refused ? "error" : l.UsedStorePreview ? "warn" : "ok")));
        }

        if (Wants("saved"))
        {
            total += await _db.Transcriptions.CountAsync(ct);
            rows.AddRange((await _db.Transcriptions.AsNoTracking().OrderByDescending(t => t.CreatedAtUtc).Take(depth)
                    .Select(t => new { t.CreatedAtUtc, t.UserId, t.Title }).ToListAsync(ct))
                .Select(t => (t.CreatedAtUtc, "saved", (Guid?)t.UserId, $"Saved “{t.Title}”", (string?)null, "ok")));
        }

        if (Wants("payment"))
        {
            var payments = _db.PaymentTransactions.Where(p => p.Status == PaymentStatus.Completed || p.Status == PaymentStatus.Failed);
            total += await payments.CountAsync(ct);
            rows.AddRange((await payments.AsNoTracking().OrderByDescending(p => p.UpdatedAtUtc).Take(depth)
                    .Select(p => new { p.UpdatedAtUtc, p.UserId, p.Status, p.AmountMinor, p.Currency, p.Provider, p.FailureReason }).ToListAsync(ct))
                .Select(p => (p.UpdatedAtUtc, "payment", (Guid?)p.UserId,
                    p.Status == PaymentStatus.Completed ? "Payment received" : "Payment failed",
                    (string?)($"{p.Currency} {p.AmountMinor / 100m:#,0.00} via {p.Provider}"
                        + (p.FailureReason is null ? "" : $" · {p.FailureReason}")),
                    p.Status == PaymentStatus.Completed ? "ok" : "error")));
        }

        if (Wants("action"))
        {
            var actions = _db.WebEvents.Where(e => e.Kind == WebEvent.Action && e.UserId != null);
            total += await actions.CountAsync(ct);
            rows.AddRange((await actions.AsNoTracking().OrderByDescending(e => e.OccurredAtUtc).Take(depth)
                    .Select(e => new { e.OccurredAtUtc, e.UserId, e.Name, e.Detail, e.Path }).ToListAsync(ct))
                .Select(e => (e.OccurredAtUtc, "action", e.UserId, e.Name ?? "Action",
                    e.Detail is null ? $"on {e.Path}" : $"{e.Detail} · on {e.Path}", JourneyTone(e.Name))));
        }

        var pageRows = rows.OrderByDescending(r => r.At).Skip((page - 1) * pageSize).Take(pageSize).ToList();

        var userIds = pageRows.Select(r => r.UserId).OfType<Guid>().Distinct().ToList();
        var users = await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email, u.Country }).ToDictionaryAsync(u => u.Id, ct);

        var items = pageRows.Select(r =>
        {
            var u = r.UserId is { } id ? users.GetValueOrDefault(id) : null;
            return new FeedItemDto(r.At, r.Kind, r.Title, r.Detail, r.Tone, r.UserId, u?.FullName, u?.Email, u?.Country);
        }).ToList();

        return new PagedResultDto<FeedItemDto>(items, page, pageSize, Math.Min(total, GetActivityFeedQuery.MaxDepth));
    }

    private static string JourneyTone(string? name) => GetJourneyQueryHandler.ToneOf(name);
}
