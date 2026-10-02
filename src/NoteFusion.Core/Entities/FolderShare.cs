using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities;

/// <summary>
/// A public link to one of a user's folders: whoever opens it sees every sheet filed in that folder,
/// including ones filed after the link was made, each opening as its own shared sheet. Removing the
/// link stops the list; the sheets keep their own links until those are stopped too.
/// </summary>
public class FolderShare : BaseEntity
{
    private FolderShare() { } // persistence

    public Guid UserId { get; private set; }
    public string Folder { get; private set; } = string.Empty;
    public string Token { get; private set; } = string.Empty;
    public DateTime CreatedAtUtc { get; private set; }
    public int Views { get; private set; }

    public static FolderShare Create(Guid userId, string folder, string token, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            Folder = Guard.NotNullOrWhiteSpace(folder),
            Token = Guard.NotNullOrWhiteSpace(token),
            CreatedAtUtc = utcNow,
        };

    public void RecordView() => Views++;

    /// <summary>Follows a folder that was renamed, so its link keeps working.</summary>
    public void Rename(string folder) => Folder = Guard.NotNullOrWhiteSpace(folder);
}
