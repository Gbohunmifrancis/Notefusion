using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

public class SendUserEmailTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Admin_can_send_custom_email_to_user()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        var handler = new SendUserEmailCommandHandler(h.Db, Caller(admin), h.Email, h.AuditAs(admin));
        var command = new SendUserEmailCommand(
            target.Id,
            "Welcome to NoteFusion Pro",
            "Special Access",
            "We have activated your pro account.",
            "Open NoteFusion",
            "https://notefusion.app",
            "Promotional outreach");

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsSuccess);

        // Verify email was dispatched
        var sent = Assert.Single(h.Email.CustomEmails);
        Assert.Equal(target.Email, sent.To.Email);
        Assert.Equal("Welcome to NoteFusion Pro", sent.Subject);
        Assert.Equal("Special Access", sent.Heading);
        Assert.Equal("We have activated your pro account.", sent.BodyHtml);
        Assert.Equal("Open NoteFusion", sent.CtaText);
        Assert.Equal("https://notefusion.app", sent.CtaUrl);

        // Verify audit log
        var log = Assert.Single(h.Db.AdminAuditLogs.AsNoTracking().ToList());
        Assert.Equal(AdminAuditAction.SendEmail, log.Action);
        Assert.Equal(admin.Id, log.ActorUserId);
        Assert.Equal(target.Id, log.TargetUserId);
        Assert.Equal("Promotional outreach", log.Note);
    }

    [Fact]
    public async Task Non_admin_cannot_send_custom_email()
    {
        using var h = new TestHarness(Now);
        var (_, target) = Seed(h);

        var nonAdminCaller = new StubCurrentUser(target.Id, UserRole.User, target.Email, target.FullName);
        var handler = new SendUserEmailCommandHandler(h.Db, nonAdminCaller, h.Email, h.AuditAs(target));
        var command = new SendUserEmailCommand(
            target.Id,
            "Subject",
            null,
            "Body content",
            null,
            null,
            null);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_UNAUTHORIZED", result.Error.Code);
        Assert.Empty(h.Email.CustomEmails);
    }

    [Fact]
    public async Task Sending_email_to_non_existent_user_returns_not_found()
    {
        using var h = new TestHarness(Now);
        var (admin, _) = Seed(h);

        var handler = new SendUserEmailCommandHandler(h.Db, Caller(admin), h.Email, h.AuditAs(admin));
        var command = new SendUserEmailCommand(
            Guid.NewGuid(),
            "Subject",
            null,
            "Body content",
            null,
            null,
            null);

        var result = await handler.Handle(command, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error.Code);
        Assert.Empty(h.Email.CustomEmails);
    }

    [Theory]
    [InlineData("", "Body")]
    [InlineData("Subject", "")]
    [InlineData("Subject", "Body", "CTA Text", "not-a-valid-url")]
    public async Task Validator_enforces_required_fields_and_valid_urls(
        string subject,
        string body,
        string? ctaText = null,
        string? ctaUrl = null)
    {
        var validator = new SendUserEmailCommandValidator();
        var command = new SendUserEmailCommand(
            Guid.NewGuid(),
            subject,
            null,
            body,
            ctaText,
            ctaUrl,
            null);

        var validationResult = await validator.ValidateAsync(command);

        Assert.False(validationResult.IsValid);
    }

    private static (User Admin, User Target) Seed(TestHarness h)
    {
        var admin = User.CreateAdmin("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-200));
        var target = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));

        h.Db.Users.Add(admin);
        h.Db.Users.Add(target);
        h.Db.SaveChanges();

        return (admin, target);
    }

    private static StubCurrentUser Caller(User admin)
        => new(admin.Id, admin.Role, admin.Email, admin.FullName);
}
