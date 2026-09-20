using System.Text.Json;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.WebPreview;

public sealed record RecordProductEventCommand(
    string Event,
    string? AnonymousId,
    string? JobId,
    string? Surface,
    IReadOnlyDictionary<string, string?>? Metadata)
    : MediatR.IRequest<Result<ProductEventDto>>;

public sealed class RecordProductEventCommandHandler : MediatR.IRequestHandler<RecordProductEventCommand, Result<ProductEventDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly WebPreviewSettings _settings;
    private readonly ICurrentUser _currentUser;

    public RecordProductEventCommandHandler(
        IApplicationDbContext db,
        IDateTimeProvider clock,
        WebPreviewSettings settings,
        ICurrentUser currentUser)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
        _currentUser = currentUser;
    }

    public async Task<Result<ProductEventDto>> Handle(
        RecordProductEventCommand request,
        CancellationToken cancellationToken)
    {
        if (!ProductEventNames.Allowed.Contains(request.Event))
            return WebPreviewErrors.InvalidEvent;

        var surface = string.IsNullOrWhiteSpace(request.Surface) ? "web" : request.Surface.Trim();
        if (surface.Length > 32 || request.AnonymousId?.Length > 128 || request.JobId?.Length > 100)
            return WebPreviewErrors.InvalidEvent;

        var metadata = request.Metadata ?? new Dictionary<string, string?>();
        if (metadata.Count > 12 || metadata.Any(kv => kv.Key.Length > 48 || kv.Value?.Length > 160))
            return WebPreviewErrors.EventTooLarge;

        var metadataJson = JsonSerializer.Serialize(metadata);
        if (metadataJson.Length > _settings.MaxEventMetadataBytes)
            return WebPreviewErrors.EventTooLarge;

        var occurred = _clock.UtcNow;

        // The endpoint is anonymous, but authentication still runs, so an event posted after sign-up
        // carries the account while keeping the same anonymousId the pre-sign-up events used. That pair on
        // one row is what lets the funnel follow a visitor across the moment they became a user.
        _db.ProductEvents.Add(ProductEvent.Record(
            request.Event,
            occurred,
            surface,
            request.AnonymousId,
            request.JobId,
            metadataJson,
            _currentUser.UserId));
        await _db.SaveChangesAsync(cancellationToken);

        return new ProductEventDto(request.Event, occurred);
    }
}
