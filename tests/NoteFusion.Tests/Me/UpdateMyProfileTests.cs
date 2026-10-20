using NoteFusion.Application.Me.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Me;

/// <summary>
/// The phone and web clients send the name alone, so a profile update that leaves the phone out must keep the one
/// on file; only an empty value clears it.
/// </summary>
public class UpdateMyProfileTests
{
    [Fact]
    public async Task A_name_change_keeps_the_phone_on_file()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h, phone: "+2348012345678");

        var result = await Handler(h, user.Id).Handle(new UpdateMyProfileCommand("Grace Okafor", null), default);

        Assert.True(result.IsSuccess);
        var saved = h.Db.Users.Single();
        Assert.Equal("Grace Okafor", saved.FullName);
        Assert.Equal("+2348012345678", saved.PhoneNumber);
    }

    [Fact]
    public async Task A_new_phone_is_saved_trimmed_and_an_empty_one_clears_it()
    {
        using var h = new TestHarness();
        var user = await SeedUser(h, phone: "+2348012345678");

        await Handler(h, user.Id).Handle(new UpdateMyProfileCommand("Test User", "  +2348099999999 "), default);
        Assert.Equal("+2348099999999", h.Db.Users.Single().PhoneNumber);

        await Handler(h, user.Id).Handle(new UpdateMyProfileCommand("Test User", "  "), default);
        Assert.Null(h.Db.Users.Single().PhoneNumber);
    }

    private static UpdateMyProfileCommandHandler Handler(TestHarness h, Guid userId)
        => new(h.Db, new StubCurrentUser(userId));

    private static async Task<User> SeedUser(TestHarness h, string phone)
    {
        var user = User.Create("Test User", "user@example.com", h.Hasher.Hash("password123"), h.Clock.UtcNow);
        user.UpdateProfile("Test User", phone);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }
}
