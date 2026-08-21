namespace NoteFusion.Application.Auth.Dtos;

/// <summary>Identity summary embedded in the login/register response for client routing.</summary>
public sealed record AuthUserDto(
    Guid Id,
    string FullName,
    string Email,
    string Role);

/// <summary>Response for a successful login or registration.</summary>
public sealed record LoginResponse(
    string AccessToken,
    string RefreshToken,
    int ExpiresIn,
    AuthUserDto User);

/// <summary>
/// Response for a registration that is waiting on its emailed code. Carries no tokens — the account
/// exists but cannot be signed into yet, and that is the point.
/// </summary>
/// <remarks>
/// The email is echoed rather than assumed by the client because the server normalises it (trimmed,
/// lower-cased). The verify call must send back the same string the row is keyed on, and the code screen
/// shows it so a typo in the address is visible before the user waits for mail that will never arrive.
/// </remarks>
public sealed record RegistrationResponse(string Email);

/// <summary>Response for a token refresh — a rotated access/refresh pair.</summary>
public sealed record TokenPairResponse(string AccessToken, string RefreshToken, int ExpiresIn);

/// <summary>Response for a successful password change — a fresh token pair.</summary>
public sealed record ChangePasswordResponse(
    string AccessToken,
    string RefreshToken,
    int ExpiresIn);
