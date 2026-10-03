using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace NoteFusion.Infrastructure.Media;

/// <summary>
/// One line at startup saying where profile photos go, so a deploy whose R2 settings never reached
/// the container is visible in the first screen of logs instead of discovered from a user whose
/// photo would not save.
/// </summary>
public sealed class MediaReadiness : IHostedService
{
    private readonly R2Settings _settings;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<MediaReadiness> _logger;

    public MediaReadiness(R2Settings settings, IHostEnvironment environment, ILogger<MediaReadiness> logger)
    {
        _settings = settings;
        _environment = environment;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (_settings.IsConfigured)
            _logger.LogInformation("Profile photos are stored in R2 bucket {Bucket} and served from {PublicBaseUrl}.", _settings.BucketName, _settings.PublicBaseUrl);
        else if (_settings.UseR2)
            _logger.LogError("R2__UseR2 is on but R2__AccountId, R2__AccessKeyId, R2__SecretAccessKey, R2__BucketName or R2__PublicBaseUrl is missing; profile photo uploads are disabled.");
        else if (_environment.IsDevelopment())
            _logger.LogInformation("Profile photo uploads are disabled: R2 is not configured.");
        else
            _logger.LogWarning("Profile photo uploads are disabled because R2 is not configured: set R2__UseR2=true with R2__AccountId, R2__AccessKeyId, R2__SecretAccessKey, R2__BucketName and R2__PublicBaseUrl.");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
