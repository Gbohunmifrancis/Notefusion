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

/// <summary>Response for a token refresh — a rotated access/refresh pair.</summary>
public sealed record TokenPairResponse(string AccessToken, string RefreshToken, int ExpiresIn);

/// <summary>Response for a successful password change — a fresh token pair.</summary>
public sealed record ChangePasswordResponse(
    string AccessToken,
    string RefreshToken,
    int ExpiresIn);
