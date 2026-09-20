namespace NoteFusion.Application.Analytics.Dtos;

public sealed record WebFunnelMetricDto(string Event, int Count);

public sealed record WebFunnelDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int PreviewJobs,
    int CompletedPreviews,
    int FailedPreviews,
    int ExpiredPreviews,
    IReadOnlyList<WebFunnelMetricDto> Events);
