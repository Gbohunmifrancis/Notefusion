using NoteFusion.Application.Common.Interfaces;

namespace NoteFusion.Infrastructure.Security;

/// <summary>System-clock implementation of <see cref="IDateTimeProvider"/>.</summary>
public sealed class DateTimeProvider : IDateTimeProvider
{
    public DateTime UtcNow => DateTime.UtcNow;
}
