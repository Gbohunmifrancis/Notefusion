namespace NoteFusion.Application.Outreach;

/// <summary>
/// Signs and reads the token in an email's one-click unsubscribe link: the account id with an HMAC over it,
/// so the link needs no sign-in and cannot be made for somebody else's account. It does not expire, because
/// an unsubscribe link in an old email must still work.
/// </summary>
public interface IEmailUnsubscribeTokens
{
    string Create(Guid userId);

    /// <summary>The account the token was made for, or null when it is malformed or not ours.</summary>
    Guid? Read(string? token);
}
