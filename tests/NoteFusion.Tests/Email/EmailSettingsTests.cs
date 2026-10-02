using Microsoft.Extensions.Configuration;
using NoteFusion.Infrastructure.Email;

namespace NoteFusion.Tests.Email;

/// <summary>
/// One secret is the whole email setup. The deploy wrote the key as <c>Resend__ApiKey</c> while the app
/// read <c>Email__ApiKey</c> and also wanted <c>Email__UseResend=true</c>, so nothing was ever sent; the
/// resolver accepts every spelling and turns delivery on by itself.
/// </summary>
public class EmailSettingsTests
{
    private static EmailSettings Resolve(params (string Key, string Value)[] pairs)
        => EmailSettings.Resolve(new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.ToDictionary(p => p.Key, p => (string?)p.Value))
            .Build());

    [Fact]
    public void A_bare_resend_key_turns_delivery_on_from_the_product_domain()
    {
        var settings = Resolve(("RESEND_API_KEY", "re_live_123"));

        Assert.True(settings.UseResend);
        Assert.Equal("re_live_123", settings.ApiKey);
        Assert.Equal("no-reply@notefusion.studio", settings.FromAddress);
    }

    [Fact]
    public void The_key_is_read_under_the_name_the_deploy_used_to_write()
    {
        var settings = Resolve(("Resend:ApiKey", " re_old "), ("Resend:From", "hello@notefusion.studio"), ("Email:UseResend", ""));

        Assert.True(settings.UseResend);
        Assert.Equal("re_old", settings.ApiKey);
        Assert.Equal("hello@notefusion.studio", settings.FromAddress);
    }

    [Fact]
    public void The_email_section_wins_over_the_fallbacks()
    {
        var settings = Resolve(("Email:ApiKey", "re_new"), ("Resend:ApiKey", "re_old"), ("Email:FromAddress", "a@notefusion.studio"), ("Resend:From", "b@notefusion.studio"));

        Assert.Equal("re_new", settings.ApiKey);
        Assert.Equal("a@notefusion.studio", settings.FromAddress);
    }

    [Fact]
    public void Blank_values_from_unset_deploy_secrets_do_not_erase_the_defaults()
    {
        var settings = Resolve(("Email:ApiKey", "re_live"), ("Email:FromAddress", ""), ("Email:AssetBaseUrl", ""), ("Email:UseResend", ""), ("Resend:From", ""));

        Assert.True(settings.UseResend);
        Assert.Equal("no-reply@notefusion.studio", settings.FromAddress);
        Assert.Equal("https://notefusion.studio", settings.AssetBaseUrl);
        Assert.Equal("NoteFusion", settings.FromName);
    }

    [Fact]
    public void Nothing_configured_keeps_mail_in_the_log()
    {
        var settings = Resolve();

        Assert.False(settings.UseResend);
        Assert.Equal(string.Empty, settings.ApiKey);
    }

    [Fact]
    public void An_explicit_off_switch_is_honoured_even_with_a_key()
    {
        var settings = Resolve(("RESEND_API_KEY", "re_live_123"), ("Email:UseResend", "false"));

        Assert.False(settings.UseResend);
    }
}
