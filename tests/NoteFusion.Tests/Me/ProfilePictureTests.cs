using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Me.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Me;

/// <summary>
/// Avatar tests. The value here is the ordering guarantee: storage is remote and fails, and the
/// user's existing picture must survive a failed replacement rather than vanishing because the
/// record was cleared before the upload was known to have worked.
/// </summary>
public class ProfilePictureTests
{
    [Fact]
    public async Task Upload_persists_the_returned_url()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        var storage = new StubImageStorage { Url = "https://cdn.test/avatars/one.jpg" };

        var result = await UploadHandler(h, user.Id, storage).Handle(Command(), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("https://cdn.test/avatars/one.jpg", result.Value.ProfilePictureUrl);
        Assert.Equal("https://cdn.test/avatars/one.jpg", h.Db.Users.Single().ProfilePictureUrl);
        Assert.Equal(user.Id, storage.UploadedFor);
    }

    [Fact]
    public async Task A_failed_upload_leaves_the_previous_picture_intact()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        user.SetProfilePicture("https://cdn.test/avatars/existing.jpg");
        await h.Db.SaveChangesAsync();

        var result = await UploadHandler(h, user.Id, new StubImageStorage { Fail = true })
            .Handle(Command(), default);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_PICTURE_UPLOAD_FAILED", result.Error.Code);
        // The whole point of uploading before saving: a network failure must not cost the user
        // the photo they already had.
        Assert.Equal("https://cdn.test/avatars/existing.jpg", h.Db.Users.Single().ProfilePictureUrl);
    }

    [Fact]
    public async Task Replacing_a_picture_overwrites_the_old_url()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        user.SetProfilePicture("https://cdn.test/avatars/old.jpg");
        await h.Db.SaveChangesAsync();

        var result = await UploadHandler(h, user.Id, new StubImageStorage { Url = "https://cdn.test/avatars/new.jpg" })
            .Handle(Command(), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("https://cdn.test/avatars/new.jpg", h.Db.Users.Single().ProfilePictureUrl);
    }

    [Fact]
    public async Task Remove_clears_the_url_and_deletes_the_stored_file()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        user.SetProfilePicture("https://cdn.test/avatars/one.jpg");
        await h.Db.SaveChangesAsync();
        var storage = new StubImageStorage();

        var result = await RemoveHandler(h, user.Id, storage).Handle(new RemoveMyProfilePictureCommand(), default);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value.ProfilePictureUrl);
        Assert.Null(h.Db.Users.Single().ProfilePictureUrl);
        Assert.Equal(user.Id, storage.DeletedFor);
    }

    [Fact]
    public async Task Remove_still_clears_the_record_when_storage_deletion_throws()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h);
        user.SetProfilePicture("https://cdn.test/avatars/one.jpg");
        await h.Db.SaveChangesAsync();

        // The save has already committed by the time storage is called, so a throw there must not
        // turn a successful removal into an error response.
        var result = await RemoveHandler(h, user.Id, new StubImageStorage { ThrowOnDelete = true })
            .Handle(new RemoveMyProfilePictureCommand(), default);

        Assert.True(result.IsSuccess);
        Assert.Null(h.Db.Users.Single().ProfilePictureUrl);
    }

    [Fact]
    public async Task Rejects_an_unauthenticated_caller_without_touching_storage()
    {
        using var h = new TestHarness();
        await SeedUser(h);
        var storage = new StubImageStorage { Url = "https://cdn.test/avatars/one.jpg" };

        var result = await UploadHandler(h, userId: null, storage).Handle(Command(), default);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error.Code);
        Assert.Null(storage.UploadedFor);
        Assert.Null(h.Db.Users.Single().ProfilePictureUrl);
    }

    private static UpdateMyProfilePictureCommand Command() =>
        new(new MemoryStream([1, 2, 3]), "avatar.jpg");

    private static UpdateMyProfilePictureCommandHandler UploadHandler(
        TestHarness h, Guid? userId, StubImageStorage storage)
        => new(h.Db, new StubCurrentUser(userId), storage);

    private static RemoveMyProfilePictureCommandHandler RemoveHandler(
        TestHarness h, Guid? userId, StubImageStorage storage)
        => new(h.Db, new StubCurrentUser(userId), storage);

    private static async Task<User> SeedUser(TestHarness h)
    {
        var user = User.Create("Test User", "user@example.com", h.Hasher.Hash("password123"), h.Clock.UtcNow);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }

    /// <summary>Records what the handler asked storage to do, and can be told to fail.</summary>
    private sealed class StubImageStorage : IImageStorage
    {
        public string Url { get; init; } = "https://cdn.test/avatars/stub.jpg";
        public bool Fail { get; init; }
        public bool ThrowOnDelete { get; init; }
        public Guid? UploadedFor { get; private set; }
        public Guid? DeletedFor { get; private set; }

        public Task<Result<string>> UploadAvatarAsync(
            Stream content, string fileName, Guid userId, CancellationToken ct)
        {
            if (Fail)
                return Task.FromResult<Result<string>>(UserErrors.PictureUploadFailed);

            UploadedFor = userId;
            return Task.FromResult<Result<string>>(Url);
        }

        public Task DeleteAvatarAsync(Guid userId, CancellationToken ct)
        {
            if (ThrowOnDelete)
                throw new HttpRequestException("storage unreachable");

            DeletedFor = userId;
            return Task.CompletedTask;
        }
    }
}
