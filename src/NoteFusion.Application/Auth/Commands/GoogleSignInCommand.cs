using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Auth.Dtos;
using NoteFusion.Application.Auth.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Auth.Commands;

/// <summary>
/// Signs in with a Google ID token, creating the account on first use. Sign-up and sign-in are
/// one endpoint because the client cannot know which it is: Google returns the same token either
/// way, and asking the user to pick would be a question only the server can answer.
/// </summary>
public sealed record GoogleSignInCommand(string IdToken) : IRequest<Result<LoginResponse>>;

public sealed class GoogleSignInCommandValidator : AbstractValidator<GoogleSignInCommand>
{
    public GoogleSignInCommandValidator()
    {
        RuleFor(x => x.IdToken).NotEmpty();
    }
}

public sealed class GoogleSignInCommandHandler : IRequestHandler<GoogleSignInCommand, Result<LoginResponse>>
{
    private readonly IApplicationDbContext _db;
    private readonly IGoogleTokenValidator _googleTokenValidator;
    private readonly ITokenIssuer _tokenIssuer;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;

    public GoogleSignInCommandHandler(
        IApplicationDbContext db,
        IGoogleTokenValidator googleTokenValidator,
        ITokenIssuer tokenIssuer,
        IDateTimeProvider clock,
        IEmailSender email)
    {
        _db = db;
        _googleTokenValidator = googleTokenValidator;
        _tokenIssuer = tokenIssuer;
        _clock = clock;
        _email = email;
    }

    public async Task<Result<LoginResponse>> Handle(
        GoogleSignInCommand request, CancellationToken cancellationToken)
    {
        var identity = await _googleTokenValidator.ValidateAsync(request.IdToken, cancellationToken);
        if (identity is null)
            return AuthErrors.InvalidGoogleToken;

        // Everything below keys off the email, so an unverified one is disqualifying: without
        // Google's assurance, a token bearing someone else's address would link or create an
        // account for a person who never consented.
        if (!identity.EmailVerified)
            return AuthErrors.GoogleEmailNotVerified;

        var email = identity.Email.Trim().ToLowerInvariant();
        var now = _clock.UtcNow;

        // Match on the Google subject first — it is the stable identifier. Email is the
        // fallback only so an existing password account can be linked rather than duplicated
        // (the unique email index would reject the insert anyway).
        var user = await _db.Users.FirstOrDefaultAsync(
            u => u.GoogleId == identity.SubjectId, cancellationToken)
            ?? await _db.Users.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);

        var isNewAccount = user is null;
        if (user is null)
        {
            user = User.CreateFromGoogle(
                fullName: string.IsNullOrWhiteSpace(identity.FullName) ? email : identity.FullName.Trim(),
                email: email,
                googleId: identity.SubjectId,
                profilePictureUrl: identity.PictureUrl,
                utcNow: now);
            _db.Users.Add(user);
        }
        else
        {
            if (!user.IsActive)
                return AuthErrors.AccountInactive;

            if (user.GoogleId is null)
                user.LinkGoogleAccount(identity.SubjectId);

            user.SetProfilePictureIfMissing(identity.PictureUrl);
        }

        user.RecordSuccessfulLogin(now);
        var tokens = _tokenIssuer.Issue(user);
        await _db.SaveChangesAsync(cancellationToken);

        // Only the first Google sign-in creates an account, and only that one earns a welcome —
        // returning users signing in must not be greeted as new. Post-commit and best-effort.
        if (isNewAccount)
            await _email.SendWelcomeAsync(new EmailRecipient(user.Email, user.FullName), cancellationToken);

        return new LoginResponse(
            tokens.AccessToken,
            tokens.RefreshToken,
            tokens.ExpiresIn,
            new AuthUserDto(user.Id, user.FullName, user.Email, user.Role.ToString()));
    }
}
