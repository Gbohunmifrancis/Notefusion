using NoteFusion.Api.Common;
using Sentry;
using Sentry.Protocol;

namespace NoteFusion.Tests.Api;

/// <summary>
/// No email address reaches Sentry: a log line's message, its string properties (tags), an exception's
/// message and the breadcrumbs before an error are all masked; everything else is left as it was.
/// </summary>
public class SentryScrubTests
{
    [Fact]
    public void An_email_in_the_message_is_masked_and_the_rest_kept()
    {
        var e = new SentryEvent
        {
            Message = new SentryMessage
            {
                Message = "Could not send outreach to {Recipient}.",
                Formatted = "Could not send outreach to ada.lovelace+notes@gmail.com.",
            },
        };

        SentryScrub.Event(e);

        Assert.Equal("Could not send outreach to [email].", e.Message!.Formatted);
        Assert.Equal("Could not send outreach to {Recipient}.", e.Message.Message);
    }

    [Fact]
    public void A_tag_or_extra_holding_an_email_is_masked_and_other_tags_are_not()
    {
        var e = new SentryEvent();
        e.SetTag("Recipient", "ada@example.org");
        e.SetTag("EmailKind", "Outreach");
        e.SetExtra("To", "ada@example.org");

        SentryScrub.Event(e);

        Assert.Equal("[email]", e.Tags["Recipient"]);
        Assert.Equal("Outreach", e.Tags["EmailKind"]);
        Assert.Equal("[email]", e.Extra["To"]);
    }

    [Fact]
    public void An_exception_message_with_an_email_is_masked()
    {
        var e = new SentryEvent
        {
            SentryExceptions = [new SentryException { Type = "InvalidOperationException", Value = "No account for bob@example.com" }],
        };

        SentryScrub.Event(e);

        Assert.Equal("No account for [email]", e.SentryExceptions!.Single().Value);
    }

    [Fact]
    public void The_request_keeps_its_method_and_path_but_no_headers_cookies_or_query()
    {
        var e = new SentryEvent();
        e.Request.Method = "GET";
        e.Request.Url = "https://api.notefusion.studio/api/email/unsubscribe";
        e.Request.QueryString = "?token=abc&email=ada@example.org";
        e.Request.Cookies = "nf=1";
        e.Request.Headers["X-Device-Id"] = "device-123";
        e.Request.Headers["User-Agent"] = "NoteFusion/1.0.1";

        SentryScrub.Event(e);

        Assert.Equal("GET", e.Request.Method);
        Assert.Equal("https://api.notefusion.studio/api/email/unsubscribe", e.Request.Url);
        Assert.Null(e.Request.QueryString);
        Assert.Null(e.Request.Cookies);
        Assert.Empty(e.Request.Headers);
    }

    [Fact]
    public void A_breadcrumb_with_an_email_is_masked_and_one_without_is_returned_as_it_was()
    {
        var withEmail = new Breadcrumb("Seeded admin account admin@notefusion.studio.", "default", category: "NoteFusion.Seeder");
        var without = new Breadcrumb("Job 1a2b3c4d done", "default");

        var masked = SentryScrub.Breadcrumb(withEmail);

        Assert.Equal("Seeded admin account [email].", masked.Message);
        Assert.Equal("NoteFusion.Seeder", masked.Category);
        Assert.Same(without, SentryScrub.Breadcrumb(without));
    }

    [Fact]
    public void Text_without_an_address_is_unchanged()
    {
        Assert.Equal("Rate limited at api.paystack.co @ 3/s", SentryScrub.Text("Rate limited at api.paystack.co @ 3/s"));
        Assert.Null(SentryScrub.Text(null));
    }
}
