using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Devices.Commands;

/// <summary>
/// Tells one user that a newer build is in the store. The in-app pop-up only reaches someone who has
/// already opened the app, which is exactly the user who least needs telling — this is the half that
/// reaches everyone else.
/// </summary>
/// <remarks>
/// <para>
/// Per user rather than per device, because <see cref="IPushSender"/> addresses users: a per-device
/// command would still fan out to every one of that user's devices, so someone with a phone and a
/// tablet would get the same notice twice. Instead every device row is marked when the notice goes
/// out, and the notice goes out when <em>any</em> of them is behind.
/// </para>
/// <para>
/// The handler re-checks that the user is genuinely behind rather than trusting its caller, so the
/// rule lives in one place and a direct invocation cannot nag someone who already updated. Idempotent
/// per release: the claim on <c>NotifiedBuild</c> is committed before the send, so a failed delivery
/// costs one notice instead of looping.
/// </para>
/// </remarks>
public sealed record NotifyAppUpdateCommand(Guid UserId) : IRequest<Result>;

public sealed class NotifyAppUpdateCommandHandler : IRequestHandler<NotifyAppUpdateCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly IPushSender _push;
    private readonly AppReleaseSettings _release;

    public NotifyAppUpdateCommandHandler(
        IApplicationDbContext db, IDateTimeProvider clock, IPushSender push, AppReleaseSettings release)
    {
        _db = db;
        _clock = clock;
        _push = push;
        _release = release;
    }

    public async Task<Result> Handle(NotifyAppUpdateCommand request, CancellationToken ct)
    {
        // Nothing announced yet. Guarded here as well as in the sweep, because this is the invariant
        // that keeps an unconfigured deployment silent and it should not rest on the caller.
        if (_release.LatestBuild <= 0)
            return Result.Success();

        var devices = await _db.DeviceTokens
            .Where(t => t.UserId == request.UserId)
            .ToListAsync(ct);

        // Every device unregistered between the sweep and here. Not a failure — there is nobody to
        // tell, which is the state this command was trying to reach anyway.
        if (devices.Count == 0)
            return Result.Success();

        if (devices.All(d => d.AppBuild >= _release.LatestBuild))
            return Result.Success();

        // Mark them all, not only the ones behind: the push reaches all of them, so leaving a sibling
        // unmarked would let the next sweep pick this user up and send a second time.
        var now = _clock.UtcNow;
        var claimed = false;
        foreach (var device in devices)
            claimed |= device.MarkUpdateNoticeSent(_release.LatestBuild, now);

        if (!claimed)
            return Result.Success();

        await _db.SaveChangesAsync(ct);

        var body = string.IsNullOrWhiteSpace(_release.ReleaseNotes)
            ? "Update now for the latest fixes and features."
            : _release.ReleaseNotes;

        await _push.SendAsync(
            [request.UserId],
            new PushMessage(
                $"NoteFusion {_release.LatestVersion} is out",
                body,
                new Dictionary<string, string> { ["screen"] = "AppUpdate" }),
            ct);

        return Result.Success();
    }
}
