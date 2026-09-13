using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Waitlist.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using Xunit;

namespace NoteFusion.Tests.Waitlist;

public sealed class WaitlistTests : IDisposable
{
    private readonly TestHarness _harness = new();

    public void Dispose() => _harness.Dispose();

    [Fact]
    public async Task JoinWaitlist_ValidEmail_PersistsAndSendsConfirmationEmail()
    {
        var handler = new JoinWaitlistCommandHandler(_harness.Db, _harness.Email);
        var command = new JoinWaitlistCommand(
            "ChoirDirector@Example.Com",
            "Sister Mary",
            "Choir Director",
            "website_hero");

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("choirdirector@example.com", result.Value.Email);
        Assert.Equal("Sister Mary", result.Value.FullName);
        Assert.Equal("Choir Director", result.Value.Role);

        // Verify entity in Db
        var saved = await _harness.Db.WaitlistEntries.FindAsync(result.Value.Id);
        Assert.NotNull(saved);
        Assert.Equal("choirdirector@example.com", saved.Email);
        Assert.Equal("website_hero", saved.Source);

        // Verify confirmation email was recorded
        var email = Assert.Single(_harness.Email.Sent, s => s.Kind == "waitlist-confirmation");
        Assert.Equal("choirdirector@example.com", email.To.Email);
    }

    [Fact]
    public async Task JoinWaitlist_DuplicateEmail_ReturnsAlreadyRegisteredConflict()
    {
        var handler = new JoinWaitlistCommandHandler(_harness.Db, _harness.Email);
        var command = new JoinWaitlistCommand("worship.leader@church.org", "David", "Worship Leader");

        var first = await handler.Handle(command, CancellationToken.None);
        Assert.True(first.IsSuccess);

        // Attempt second registration with same email (different case and surrounding whitespace)
        var secondCommand = new JoinWaitlistCommand("  WORSHIP.LEADER@CHURCH.ORG  ", "David Again");
        var second = await handler.Handle(secondCommand, CancellationToken.None);

        Assert.False(second.IsSuccess);
        Assert.Equal(WaitlistErrors.AlreadyRegistered.Code, second.Error.Code);
        Assert.Equal(ErrorType.Conflict, second.Error.Type);

        // Only 1 confirmation email sent
        Assert.Single(_harness.Email.Sent, s => s.Kind == "waitlist-confirmation");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("notanemail")]
    [InlineData("missing@domain")]
    public async Task JoinWaitlist_InvalidEmail_ReturnsValidationError(string invalidEmail)
    {
        var handler = new JoinWaitlistCommandHandler(_harness.Db, _harness.Email);
        var command = new JoinWaitlistCommand(invalidEmail, "User");

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(WaitlistErrors.InvalidEmail.Code, result.Error.Code);
        Assert.Equal(ErrorType.Validation, result.Error.Type);

        Assert.Empty(_harness.Email.Sent);
    }

    [Fact]
    public async Task GetWaitlistEntries_ReturnsPaginatedAndFilters()
    {
        _harness.Db.WaitlistEntries.AddRange(
            new WaitlistEntry(Guid.NewGuid(), "alpha@note.com", "Alpha User", "Teacher", "web"),
            new WaitlistEntry(Guid.NewGuid(), "beta@choir.org", "Beta Singer", "Singer", "pricing"),
            new WaitlistEntry(Guid.NewGuid(), "gamma@church.com", "Gamma Pastor", "Leader", "hero"));
        await _harness.Db.SaveChangesAsync();

        var handler = new GetWaitlistEntriesQueryHandler(_harness.Db);

        // All entries paged
        var all = await handler.Handle(new GetWaitlistEntriesQuery(1, 2), CancellationToken.None);
        Assert.True(all.IsSuccess);
        Assert.Equal(3, all.Value.TotalCount);
        Assert.Equal(2, all.Value.Items.Count);

        // Filter by search
        var filtered = await handler.Handle(
            new GetWaitlistEntriesQuery(1, 10, Search: "singer"), CancellationToken.None);
        Assert.True(filtered.IsSuccess);
        Assert.Equal(1, filtered.Value.TotalCount);
        Assert.Equal("beta@choir.org", filtered.Value.Items[0].Email);
    }
}
