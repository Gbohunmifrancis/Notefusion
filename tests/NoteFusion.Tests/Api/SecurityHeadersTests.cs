using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Controllers;
using NoteFusion.Api.Middleware;

namespace NoteFusion.Tests.Api;

/// <summary>
/// Hardening headers on every API response, and a policy for the two billing return pages that still lets
/// their own inline script run — and nothing else.
/// </summary>
public class SecurityHeadersTests
{
    [Fact]
    public void A_json_response_gets_every_header_and_the_nothing_may_run_policy()
    {
        var response = new DefaultHttpContext().Response;
        response.ContentType = "application/json; charset=utf-8";

        SecurityHeadersMiddleware.Apply(response);

        Assert.Equal("nosniff", response.Headers["X-Content-Type-Options"]);
        Assert.Equal("no-referrer", response.Headers["Referrer-Policy"]);
        Assert.Equal("DENY", response.Headers["X-Frame-Options"]);
        Assert.Equal("default-src 'none'; frame-ancestors 'none'", response.Headers.ContentSecurityPolicy);
    }

    [Fact]
    public void An_answer_over_https_says_https_only_and_one_over_http_does_not()
    {
        var secure = new DefaultHttpContext();
        secure.Request.Scheme = "https";
        var plain = new DefaultHttpContext();

        SecurityHeadersMiddleware.Apply(secure.Response);
        SecurityHeadersMiddleware.Apply(plain.Response);

        Assert.Equal("max-age=31536000", secure.Response.Headers.StrictTransportSecurity);
        Assert.False(plain.Response.Headers.ContainsKey("Strict-Transport-Security"));
    }

    [Fact]
    public void A_response_with_no_body_type_is_treated_as_api_content()
    {
        var response = new DefaultHttpContext().Response;

        SecurityHeadersMiddleware.Apply(response);

        Assert.Equal(SecurityHeadersMiddleware.ApiContentSecurityPolicy, response.Headers.ContentSecurityPolicy);
    }

    [Fact]
    public void An_html_page_keeps_the_policy_it_set_for_itself()
    {
        var response = new DefaultHttpContext().Response;
        response.ContentType = "text/html; charset=utf-8";
        response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'";

        SecurityHeadersMiddleware.Apply(response);

        Assert.Equal("default-src 'none'; style-src 'unsafe-inline'", response.Headers.ContentSecurityPolicy);
        Assert.Equal("nosniff", response.Headers["X-Content-Type-Options"]);
    }

    [Theory]
    [InlineData(nameof(BillingController.Return))]
    [InlineData(nameof(BillingController.ReturnWeb))]
    public void A_billing_return_page_allows_exactly_its_own_inline_script(string action)
    {
        var controller = new BillingController(null!)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        var result = (ContentResult)typeof(BillingController).GetMethod(action)!.Invoke(controller, null)!;
        var policy = controller.Response.Headers.ContentSecurityPolicy.ToString();

        var script = Regex.Match(result.Content!, "<script>(.*?)</script>", RegexOptions.Singleline).Groups[1].Value;
        var hash = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(script)));

        Assert.Contains($"script-src 'sha256-{hash}'", policy);
        Assert.Contains("style-src 'unsafe-inline'", policy);
        Assert.Contains("frame-ancestors 'none'", policy);
        Assert.StartsWith("text/html", result.ContentType);
    }
}
