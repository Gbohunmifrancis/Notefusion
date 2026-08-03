namespace NoteFusion.Application.Common.Interfaces;

/// <summary>Abstracts the system clock so handlers stay deterministic and testable.</summary>
public interface IDateTimeProvider
{
    DateTime UtcNow { get; }
}
