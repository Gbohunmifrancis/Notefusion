using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Choir plan error codes (module: choirs). Every message is a sentence a singer can act on.</summary>
public static class ChoirErrors
{
    public static readonly Error NotInAChoir =
        Error.NotFound("CHOIR_NOT_FOUND", "You are not in a choir yet.");

    public static readonly Error DirectorOnly =
        Error.Forbidden("CHOIR_DIRECTOR_ONLY", "Only your choir's director can do that.");

    public static readonly Error InviteNotFound =
        Error.NotFound("CHOIR_INVITE_NOT_FOUND",
            "That choir code does not match any choir. Check it with your director; they may have made a new one.");

    public static readonly Error Inactive =
        Error.Forbidden("CHOIR_INACTIVE",
            "This choir's plan has ended. Ask your director to renew it.");

    public static Error Full(int seats) =>
        Error.Conflict("CHOIR_FULL",
            $"This choir is full: all {seats} places are taken. Ask your director to free one.");

    public static readonly Error AlreadyInAChoir =
        Error.Conflict("CHOIR_ALREADY_MEMBER",
            "You are already in a choir. Leave it first to join another.");

    public static readonly Error LeadsAChoir =
        Error.Conflict("CHOIR_ALREADY_DIRECTOR",
            "You lead a choir of your own, so you cannot join another while its plan is running.");

    public static readonly Error OwnChoir =
        Error.Conflict("CHOIR_OWN_CHOIR", "You lead this choir already.");

    public static readonly Error DirectorCannotLeave =
        Error.Conflict("CHOIR_DIRECTOR_CANNOT_LEAVE",
            "You lead this choir, so you cannot leave it. It stays yours when its plan ends.");

    public static readonly Error MemberNotFound =
        Error.NotFound("CHOIR_MEMBER_NOT_FOUND", "That singer is not in your choir.");

    public static readonly Error InvalidName =
        Error.Validation("CHOIR_INVALID_NAME", "Give your choir a name of up to 80 characters.");

    public static readonly Error SheetNotFound =
        Error.NotFound("CHOIR_SHEET_NOT_FOUND", "This sheet is no longer in your choir's library.");

    public static readonly Error MemberOfAnotherChoir =
        Error.Conflict("CHOIR_MEMBER_OF_ANOTHER",
            "You sing in another choir. Leave it before starting a choir of your own.");
}
