using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Inbox.Sent;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Public web-initiated account deletion command satisfying Google Play Data Safety policy requirements.
/// Handles immediate deletion with valid password, token confirmation from emailed link, or dispatches
/// a secure single-use confirmation link if no credentials are provided.
/// </summary>
public sealed record DeleteAccountRequestCommand(
    string Email,
    string? Password = null,
    string? Token = null,
    string? Reason = null) : IRequest<Result<DeleteAccountResponse>>;

public sealed record DeleteAccountResponse(
    bool Success,
    bool Confirmed,
    string Message);

public sealed class DeleteAccountRequestCommandValidator : AbstractValidator<DeleteAccountRequestCommand>
{
    public DeleteAccountRequestCommandValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(254);
    }
}

public sealed class DeleteAccountRequestCommandHandler
    : IRequestHandler<DeleteAccountRequestCommand, Result<DeleteAccountResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IPasswordHasher _hasher;
    private readonly IEmailSender _email;
    private readonly IDateTimeProvider _clock;
    private readonly AuthSettings _authSettings;
    private readonly ILogger<DeleteAccountRequestCommandHandler> _logger;

    public DeleteAccountRequestCommandHandler(
        IApplicationDbContext db,
        IPasswordHasher hasher,
        IEmailSender email,
        IDateTimeProvider clock,
        AuthSettings authSettings,
        ILogger<DeleteAccountRequestCommandHandler> logger)
    {
        _db = db;
        _hasher = hasher;
        _email = email;
        _clock = clock;
        _authSettings = authSettings;
        _logger = logger;
    }

    /// <summary>
    /// What a password attempt that deleted nothing is told — the same words whether the address is unknown,
    /// the password wrong, or the account locked, because on this anonymous page any difference between those
    /// is an answer to "is this address registered?".
    /// </summary>
    public const string NotDeletedMessage =
        "We couldn't delete an account with those details. Check the email and password, or leave the password blank and we'll email a confirmation link if an account exists.";

    /// <summary>What a request for an emailed link is told, whether or not there was anyone to email.</summary>
    public const string LinkSentMessage =
        "If an account exists for this email address, a deletion confirmation link has been sent to it. Click the link within 24 hours to complete deletion. You can also delete your account anytime from within the NoteFusion mobile app.";

    private static readonly Error InvalidToken = Error.Validation(
        "auth.invalid_token",
        "The deletion link is invalid or has expired. Please submit a new deletion request.");

    private static DeleteAccountResponse NotDeleted => new(Success: true, Confirmed: false, Message: NotDeletedMessage);

    private static DeleteAccountResponse LinkSent => new(Success: true, Confirmed: false, Message: LinkSentMessage);

    public async Task<Result<DeleteAccountResponse>> Handle(
        DeleteAccountRequestCommand request, CancellationToken cancellationToken)
    {
        // Set at composition (DeletionSecretFallback) whenever the deploy has none; reaching here without one
        // means a host skipped that, and signing with an empty or published key would make links forgeable.
        if (!_authSettings.HasOwnDeletionSecret)
            throw new InvalidOperationException("AuthSettings.DeletionSecret was not resolved before use.");

        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        // Security: answer an unknown address exactly as a known one with the wrong proof is answered.
        if (user is null)
        {
            if (!string.IsNullOrWhiteSpace(request.Token))
                return Result.Failure<DeleteAccountResponse>(InvalidToken);

            if (!string.IsNullOrWhiteSpace(request.Password))
            {
                // The same bcrypt work a real account costs, so the answer's timing says nothing either.
                DummyPasswordCheck.Verify(_hasher, request.Password);
                return Result.Success(NotDeleted);
            }

            return Result.Success(LinkSent);
        }

        // Case 1: Token confirmation via emailed link
        if (!string.IsNullOrWhiteSpace(request.Token))
        {
            if (!ValidateDeletionToken(user, request.Token, _clock.UtcNow, _authSettings.DeletionSecret))
                return Result.Failure<DeleteAccountResponse>(InvalidToken);

            await ExecuteAccountDeletionAsync(user, request.Reason, cancellationToken);

            return Result.Success(new DeleteAccountResponse(
                Success: true,
                Confirmed: true,
                Message: "Your NoteFusion account, profile, and all saved transcriptions have been permanently deleted."));
        }

        // Case 2: Direct password verification. A password check anyone can reach without signing in, so it
        // carries login's lockout — without it this page was an unthrottled way around that lockout.
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            var now = _clock.UtcNow;
            if (user.PasswordHash is null)
            {
                DummyPasswordCheck.Verify(_hasher, request.Password);
                return Result.Success(NotDeleted);
            }

            var passwordMatches = _hasher.Verify(request.Password, user.PasswordHash);
            if (user.IsLockedOut(now))
                return Result.Success(NotDeleted);

            if (!passwordMatches)
            {
                user.RecordFailedLogin(now);
                await _db.SaveChangesAsync(cancellationToken);
                return Result.Success(NotDeleted);
            }

            await ExecuteAccountDeletionAsync(user, request.Reason, cancellationToken);

            return Result<DeleteAccountResponse>.Success(new DeleteAccountResponse(
                Success: true,
                Confirmed: true,
                Message: "Your NoteFusion account, profile, and all saved transcriptions have been permanently deleted."));
        }

        // Case 3: No password or token provided (e.g. Google auth or forgot password).
        // Generate secure 24-hour token and send email verification link.
        var expiryUtc = _clock.UtcNow.AddHours(24);
        var token = CreateDeletionToken(user, expiryUtc, _authSettings.DeletionSecret);

        var baseUrl = _authSettings.DeleteAccountUrl.TrimEnd('/');
        var confirmationUrl = $"{baseUrl}?email={Uri.EscapeDataString(user.Email)}&token={token}";

        try
        {
            await _email.SendCustomEmailAsync(
                new EmailRecipient(user.Email, user.FullName),
                subject: SentMailPrivacy.DeletionConfirmSubject,
                heading: "Account Deletion Request",
                bodyHtml: "Hello,\n\nWe received a request from the web deletion portal to permanently delete your NoteFusion account and all associated musical transcriptions and recordings.\n\nTo confirm this request and permanently delete your account and all data, please tap the button below. This action is permanent and cannot be undone.\n\nIf you did not request account deletion, you can ignore this email — your account and data remain safe.",
                ctaText: "Confirm Permanent Deletion",
                ctaUrl: confirmationUrl,
                ct: cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send account deletion confirmation email to {Email}", user.Email);
        }

        return Result.Success(LinkSent);
    }

    private async Task ExecuteAccountDeletionAsync(User user, string? reason, CancellationToken ct)
    {
        var transcriptions = await _db.Transcriptions
            .Where(t => t.UserId == user.Id)
            .ToListAsync(ct);

        _db.Transcriptions.RemoveRange(transcriptions);
        // Folder links too: they would otherwise reopen for whoever next registers this address (DeleteMyAccountCommand).
        _db.FolderShares.RemoveRange(await _db.FolderShares.Where(f => f.UserId == user.Id).ToListAsync(ct));
        // The phone's events and the activity log go with the account too (DeleteMyAccountCommand), leaving one nameless row.
        _db.AppEvents.RemoveRange(await _db.AppEvents.Where(e => e.UserId == user.Id).ToListAsync(ct));
        _db.UserActivities.RemoveRange(await _db.UserActivities.Where(e => e.UserId == user.Id).ToListAsync(ct));
        _db.UserActivities.Add(UserActivity.Record(user.Id, UserActivity.AccountDeleted, "via=web", null, _clock.UtcNow));
        _db.Users.Remove(user);
        await _db.SaveChangesAsync(ct);

        _logger.LogInformation("User {UserId} ({Email}) account and data deleted via web portal. Reason: {Reason}",
            user.Id, user.Email, reason ?? "None specified");

        try
        {
            await _email.SendCustomEmailAsync(
                new EmailRecipient(user.Email, user.FullName),
                subject: "Your NoteFusion account has been deleted",
                heading: "Account Deletion Confirmation",
                bodyHtml: "Your NoteFusion account, profile information, and all saved musical transcriptions and recordings have been permanently deleted from our servers as requested.\n\nIf you did not make this request or have questions, please contact our support team at hello@notefusion.studio.",
                ctaText: "Visit NoteFusion",
                ctaUrl: "https://notefusion.studio",
                ct: ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send account deleted confirmation email to {Email}", user.Email);
        }
    }

    private static string CreateDeletionToken(User user, DateTime expiryUtc, string secret)
    {
        var expiryTicks = expiryUtc.Ticks;
        var raw = $"{user.Id}:{user.Email.ToLowerInvariant()}:{expiryTicks}";
        var keyBytes = Encoding.UTF8.GetBytes(secret + ":" + user.CreatedAt.Ticks + ":" + (user.PasswordHash ?? "oauth") + ":" + user.Id);
        using var hmac = new HMACSHA256(keyBytes);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(raw));
        var hashString = Convert.ToHexString(hash);
        var tokenPayload = $"{user.Id}:{expiryTicks}:{hashString}";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(tokenPayload))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static bool ValidateDeletionToken(User user, string token, DateTime utcNow, string secret)
    {
        try
        {
            var padded = token.Replace('-', '+').Replace('_', '/');
            switch (padded.Length % 4)
            {
                case 2: padded += "=="; break;
                case 3: padded += "="; break;
            }
            var rawPayload = Encoding.UTF8.GetString(Convert.FromBase64String(padded));
            var parts = rawPayload.Split(':');
            if (parts.Length != 3) return false;

            if (!Guid.TryParse(parts[0], out var userId) || userId != user.Id) return false;
            if (!long.TryParse(parts[1], out var expiryTicks)) return false;

            var expiry = new DateTime(expiryTicks, DateTimeKind.Utc);
            if (expiry < utcNow) return false;

            var expectedRaw = $"{user.Id}:{user.Email.ToLowerInvariant()}:{expiryTicks}";
            var keyBytes = Encoding.UTF8.GetBytes(secret + ":" + user.CreatedAt.Ticks + ":" + (user.PasswordHash ?? "oauth") + ":" + user.Id);
            using var hmac = new HMACSHA256(keyBytes);
            var expectedHash = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(expectedRaw)));

            return CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(parts[2]),
                Encoding.UTF8.GetBytes(expectedHash));
        }
        catch
        {
            return false;
        }
    }
}
