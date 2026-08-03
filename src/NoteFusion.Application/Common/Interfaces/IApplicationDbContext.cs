using Microsoft.EntityFrameworkCore;
using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Common.Interfaces;

/// <summary>
/// The persistence contract the Application layer depends on. Implemented by the EF Core DbContext
/// in Infrastructure, keeping handlers free of a concrete provider reference.
/// </summary>
public interface IApplicationDbContext
{
    DbSet<User> Users { get; }
    DbSet<RefreshToken> RefreshTokens { get; }
    DbSet<DeviceToken> DeviceTokens { get; }
    DbSet<Transcription> Transcriptions { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
