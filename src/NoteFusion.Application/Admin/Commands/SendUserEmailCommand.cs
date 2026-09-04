using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

public sealed record SendUserEmailCommand(
    Guid UserId,
    string Subject,
    string? Heading,
    string BodyHtml,
    string? CtaText = null,
    string? CtaUrl = null,
    string? Note = null) : IRequest<Result>;

public sealed class SendUserEmailCommandValidator : AbstractValidator<SendUserEmailCommand>
{
    public SendUserEmailCommandValidator()
    {
        RuleFor(x => x.UserId).NotEmpty();
        RuleFor(x => x.Subject).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Heading).MaximumLength(200);
        RuleFor(x => x.BodyHtml).NotEmpty().MaximumLength(15000);
        RuleFor(x => x.CtaText).MaximumLength(100);
        RuleFor(x => x.CtaUrl).MaximumLength(2000);
    }
}

public sealed class SendUserEmailCommandHandler : IRequestHandler<SendUserEmailCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IEmailSender _email;
    private readonly IAuditLogger _audit;

    public SendUserEmailCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IEmailSender email,
        IAuditLogger audit)
    {
        _db = db;
        _currentUser = currentUser;
        _email = email;
        _audit = audit;
    }

    public async Task<Result> Handle(SendUserEmailCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is null)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        var heading = string.IsNullOrWhiteSpace(request.Heading) ? request.Subject : request.Heading;

        await _email.SendCustomEmailAsync(
            new EmailRecipient(user.Email, user.FullName),
            request.Subject,
            heading,
            request.BodyHtml,
            request.CtaText,
            request.CtaUrl,
            ct);

        _audit.Record(
            AdminAuditAction.SendEmail,
            user,
            $"Sent custom email \"{request.Subject}\".",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
