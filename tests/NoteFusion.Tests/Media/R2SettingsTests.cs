using Microsoft.Extensions.Configuration;
using NoteFusion.Infrastructure.Media;

namespace NoteFusion.Tests.Media;

/// <summary>
/// Compose passes every R2 variable whether or not the deploy set it, so the switch can arrive blank
/// or spelled any number of ways. Bound by the configuration binder, a blank one threw at startup and
/// took the whole API down with it; read by hand, anything unrecognised is simply off.
/// </summary>
public class R2SettingsTests
{
    private static R2Settings Resolve(params (string Key, string Value)[] pairs)
        => R2Settings.Resolve(new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value))
            .Build());

    [Theory]
    [InlineData("true")]
    [InlineData("True")]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData(" YES ")]
    public void The_usual_spellings_of_on_turn_uploads_on(string value)
        => Assert.True(Resolve(("R2:UseR2", value)).UseR2);

    [Theory]
    [InlineData("")]
    [InlineData("false")]
    [InlineData("0")]
    [InlineData("no")]
    [InlineData("enabled")]
    public void Anything_else_is_off_rather_than_a_startup_crash(string value)
        => Assert.False(Resolve(("R2:UseR2", value)).UseR2);

    [Fact]
    public void A_full_set_of_values_is_configured()
    {
        var settings = Resolve(
            ("R2:UseR2", "true"),
            ("R2:AccountId", "acc"),
            ("R2:AccessKeyId", "key"),
            ("R2:SecretAccessKey", "secret"),
            ("R2:BucketName", "avatars-bucket"),
            ("R2:PublicBaseUrl", " https://media.notefusion.studio "));

        Assert.True(settings.IsConfigured);
        Assert.Equal("https://media.notefusion.studio", settings.PublicBaseUrl);
        Assert.Equal("avatars", settings.KeyPrefix);
    }

    [Theory]
    [InlineData("media.notefusion.studio", "https://media.notefusion.studio")]
    [InlineData("https://media.notefusion.studio", "https://media.notefusion.studio")]
    [InlineData("http://localhost:9000", "http://localhost:9000")]
    public void A_bare_custom_domain_is_served_over_https(string configured, string expected)
        => Assert.Equal(expected, Resolve(("R2:PublicBaseUrl", configured)).PublicBaseUrl);

    [Fact]
    public void Blank_values_from_unset_deploy_secrets_leave_uploads_off()
    {
        var settings = Resolve(
            ("R2:UseR2", "true"),
            ("R2:AccountId", ""),
            ("R2:AccessKeyId", ""),
            ("R2:SecretAccessKey", ""),
            ("R2:BucketName", ""),
            ("R2:PublicBaseUrl", ""),
            ("R2:KeyPrefix", ""));

        Assert.False(settings.IsConfigured);
        Assert.Equal("avatars", settings.KeyPrefix);
    }

    [Fact]
    public void Nothing_configured_is_off()
        => Assert.False(Resolve().IsConfigured);
}
