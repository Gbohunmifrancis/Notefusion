using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
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

    public async Task<Result<DeleteAccountResponse>> Handle(
        DeleteAccountRequestCommand request, CancellationToken cancellationToken)
    {
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

        // Security: Avoid disclosing whether the email exists when no credentials are provided
        if (user is null)
        {
            return Result<DeleteAccountResponse>.Success(new DeleteAccountResponse(
                Success: true,
                Confirmed: false,
                Message: "If an account exists for this email address, a confirmation has been processed. You can also delete your account anytime from within the NoteFusion mobile app."));
        }

        // Case 1: Token confirmation via emailed link
        if (!string.IsNullOrWhiteSpace(request.Token))
        {
            if (!ValidateDeletionToken(user, request.Token, _clock.UtcNow, _authSettings.DeletionSecret))
            {
                return Result.Failure<DeleteAccountResponse>(Error.Validation(
                    "auth.invalid_token",
                    "The deletion link is invalid or has expired. Please submit a new deletion request."));
            }

            await ExecuteAccountDeletionAsync(user, request.Reason, cancellationToken);

            return Result.Success(new DeleteAccountResponse(
                Success: true,
                Confirmed: true,
                Message: "Your NoteFusion account, profile, and all saved transcriptions have been permanently deleted."));
        }

        // Case 2: Direct password verification
        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            if (user.PasswordHash is null || !_hasher.Verify(request.Password, user.PasswordHash))
            {
                return Result.Failure<DeleteAccountResponse>(Error.Validation(
                    "auth.invalid_credentials",
                    "The password you entered is incorrect. If you signed in with Google or forgot your password, leave password blank to receive an email confirmation link."));
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
                subject: "Confirm your NoteFusion account deletion request",
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

        return Result<DeleteAccountResponse>.Success(new DeleteAccountResponse(
            Success: true,
            Confirmed: false,
            Message: "A deletion confirmation link has been sent to your email. Please check your inbox and click the link within 24 hours to complete deletion."));
    }

    private async Task ExecuteAccountDeletionAsync(User user, string? reason, CancellationToken ct)
    {
        var transcriptions = await _db.Transcriptions
            .Where(t => t.UserId == user.Id)
            .ToListAsync(ct);

        _db.Transcriptions.RemoveRange(transcriptions);
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
