using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Auth.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Infrastructure.Geo;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Auth;

/// <summary>
/// Where a user is decides what they are charged, so this is a pricing control dressed as a lookup. Two
/// separate things have to be right: which address we believe the request came from, and what we do with
/// the answer. The first is adversarial — the caller can write <c>X-Forwarded-For</c> — and the second is
/// about not re-pricing someone who boarded a plane.
/// </summary>
public class CountryResolutionTests
{
    private const string NigerianIp = "41.58.1.1";
    private const string OtherIp = "8.8.8.8";

    // ------------------------------------------------------- which address do we believe

    [Fact]
    public void A_forged_forwarded_header_cannot_choose_the_address()
    {
        // The attack: send your own X-Forwarded-For naming a Nigerian address to be offered ₦ pricing.
        // Heroku's router APPENDS what it observed rather than replacing the header, so the entry the
        // caller wrote stays at the left and the truth arrives on the right. Reading the leftmost entry —
        // the textbook "original client" reading — hands the caller their own choice of country.
        var ip = ClientIpAddress.Resolve($"{NigerianIp}, {OtherIp}", "10.0.0.1", trustedProxyHops: 1);

        Assert.Equal(OtherIp, ip);
    }

    [Fact]
    public void No_amount_of_prepending_moves_the_read()
    {
        // Padding the chain is the obvious next attempt: if the position were counted from the left, a
        // longer chain would shift the read. Counted from the right, length is irrelevant.
        var ip = ClientIpAddress.Resolve(
            $"{NigerianIp}, {NigerianIp}, {NigerianIp}, {NigerianIp}, {OtherIp}", null, trustedProxyHops: 1);

        Assert.Equal(OtherIp, ip);
    }

    [Fact]
    public void With_no_trusted_proxy_the_header_is_ignored_outright()
    {
        // A process exposed directly has nothing in front of it that could have appended anything, so the
        // whole header is caller-written. Zero hops means do not read it at all.
        var ip = ClientIpAddress.Resolve($"{NigerianIp}, {NigerianIp}", OtherIp, trustedProxyHops: 0);

        Assert.Equal(OtherIp, ip);
    }

    [Fact]
    public void Two_trusted_hops_read_two_from_the_right()
    {
        // A CDN in front of Heroku: both append, so the client's real address is the second from the end.
        var ip = ClientIpAddress.Resolve($"{NigerianIp}, {OtherIp}, 172.16.9.9", null, trustedProxyHops: 2);

        Assert.Equal(OtherIp, ip);
    }

    [Fact]
    public void A_chain_shorter_than_the_trusted_hops_falls_back_rather_than_guessing()
    {
        // Misconfiguration, or a request that skipped a hop. There is no position to read, and picking the
        // nearest entry would be reading exactly the part the caller controls.
        var ip = ClientIpAddress.Resolve(NigerianIp, OtherIp, trustedProxyHops: 2);

        Assert.Equal(OtherIp, ip);
    }

    [Fact]
    public void With_no_header_at_all_the_socket_peer_is_used()
    {
        // Local development and any direct call. Nothing forged anything; there is simply no chain.
        Assert.Equal(OtherIp, ClientIpAddress.Resolve(null, OtherIp, trustedProxyHops: 1));
        Assert.Equal(OtherIp, ClientIpAddress.Resolve("", OtherIp, trustedProxyHops: 1));
    }

    [Theory]
    [InlineData("127.0.0.1")]      // loopback — a local run
    [InlineData("::1")]
    [InlineData("10.0.0.7")]       // private ranges: a container network, a proxy's own address
    [InlineData("172.20.0.3")]
    [InlineData("192.168.1.50")]
    [InlineData("169.254.10.1")]   // link-local
    [InlineData("100.100.0.1")]    // carrier-grade NAT — shared, so it identifies nobody
    [InlineData("fd00::1")]        // IPv6 unique-local
    [InlineData("not-an-ip")]
    [InlineData("999.1.1.1")]
    public void An_address_that_cannot_place_anyone_resolves_to_nothing(string address)
    {
        // Null, never a guess. Unknown country means every tier is offered — the outcome that errs toward
        // the customer — whereas an invented one prices somebody wrongly and silently.
        Assert.Null(ClientIpAddress.Resolve(address, null, trustedProxyHops: 1));
    }

    [Theory]
    [InlineData("8.8.8.8:53421", "8.8.8.8")]                 // proxies routinely append the source port
    [InlineData("[2001:4860:4860::8888]:443", "2001:4860:4860::8888")]
    [InlineData("[2001:4860:4860::8888]", "2001:4860:4860::8888")]
    [InlineData("::ffff:8.8.8.8", "8.8.8.8")]                // Kestrel's dual-stack socket form
    [InlineData("  8.8.8.8  ", "8.8.8.8")]
    public void An_entry_is_normalised_before_it_is_used(string entry, string expected)
    {
        // A lookup handed "8.8.8.8:53421" answers nothing, which would look exactly like an outage.
        Assert.Equal(expected, ClientIpAddress.Resolve(entry, null, trustedProxyHops: 1));
    }

    // ------------------------------------------------------- what does the address mean

    [Fact]
    public async Task A_two_letter_answer_is_taken_and_upper_cased()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.OK, "ng\n");

        Assert.Equal("NG", await Lookup(handler).CountryForAsync(NigerianIp));

        // The address goes in the URL, so getting the template substitution wrong would silently look up
        // whoever "{ip}" resolves to.
        Assert.Contains(NigerianIp, Assert.Single(handler.Requests).Uri!.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_rate_limited_reply_dressed_as_success_is_not_a_country()
    {
        // ipapi.co answers an over-quota request with HTTP 200 and a JSON error body. "Exactly two letters"
        // rejects it without needing to know that; a JSON parser would have to be told.
        var handler = StubHttpMessageHandler.Returning(
            HttpStatusCode.OK, """{"error":true,"reason":"RateLimited"}""");

        Assert.Null(await Lookup(handler).CountryForAsync(NigerianIp));
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, "")]
    [InlineData(HttpStatusCode.InternalServerError, "")]
    [InlineData(HttpStatusCode.OK, "Undefined")]
    [InlineData(HttpStatusCode.OK, "")]
    public async Task Anything_short_of_a_country_code_leaves_it_unknown(HttpStatusCode status, string body)
    {
        Assert.Null(await Lookup(StubHttpMessageHandler.Returning(status, body)).CountryForAsync(NigerianIp));
    }

    [Fact]
    public async Task A_lookup_outage_does_not_become_the_caller_s_problem()
    {
        // The whole reason this returns null instead of throwing: a geolocation provider being down must
        // not fail a sign-up.
        var handler = StubHttpMessageHandler.Throwing(new HttpRequestException("connection refused"));

        Assert.Null(await Lookup(handler).CountryForAsync(NigerianIp));
    }

    [Fact]
    public async Task With_the_lookup_switched_off_nobody_has_a_country()
    {
        // Geo__LookupUrl unset. Every tier is shown to everyone, which is the safe failure for a
        // misconfigured deploy: too many prices, never the wrong one.
        Assert.False(new GeoSettings { LookupUrl = "" }.IsConfigured);
        Assert.Null(await new DisabledGeoIpLookup().CountryForAsync(NigerianIp));
    }

    // ------------------------------------------------------- what we do with the answer

    [Fact]
    public async Task Sign_up_stores_the_country_it_resolved()
    {
        using var h = new TestHarness();
        h.Country.Country = "NG";

        var result = await new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country)
            .Handle(new RegisterCommand("Ada", "ada@example.com", "password123"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("NG", Assert.Single(h.Db.Users).Country);
    }

    [Fact]
    public async Task Sign_up_still_succeeds_when_the_country_is_unknown()
    {
        using var h = new TestHarness(); // resolver answers null by default

        var result = await new RegisterCommandHandler(h.Db, h.Hasher, h.Tokens, h.Clock, h.Email, h.Country)
            .Handle(new RegisterCommand("Ada", "ada@example.com", "password123"), default);

        Assert.True(result.IsSuccess);
        Assert.Null(Assert.Single(h.Db.Users).Country);
    }

    [Fact]
    public async Task Signing_in_backfills_an_account_that_never_had_one()
    {
        // Every account that existed before this feature. A sign-in is the only place to fix them without
        // inventing a new write path or putting a lookup on the paywall.
        using var h = new TestHarness();
        await Seed(h);
        h.Country.Country = "NG";

        var result = await Login(h).Handle(new LoginCommand("grace@example.com", "s3cretpw!"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("NG", Assert.Single(h.Db.Users).Country);
    }

    [Fact]
    public async Task Travelling_does_not_re_price_an_existing_user()
    {
        // A Nigerian subscriber signing in from London, or anyone on a VPN. First observation wins, so the
        // offer they have been living with stays put.
        using var h = new TestHarness();
        var user = await Seed(h);
        user.RecordCountry("NG");
        await h.Db.SaveChangesAsync();

        h.Country.Country = "GB";
        var result = await Login(h).Handle(new LoginCommand("grace@example.com", "s3cretpw!"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("NG", Assert.Single(h.Db.Users).Country);

        // And it never even asked. The guard is not just correctness — a lookup per login would burn the
        // provider's daily quota on answers that are thrown away.
        Assert.Equal(0, h.Country.Calls);
    }

    [Fact]
    public async Task A_failed_login_resolves_nothing()
    {
        // No credentials, no lookup: otherwise anyone could spend the quota by guessing passwords.
        using var h = new TestHarness();
        await Seed(h);
        h.Country.Country = "NG";

        var result = await Login(h).Handle(new LoginCommand("grace@example.com", "wrong"), default);

        Assert.True(result.IsFailure);
        Assert.Equal(0, h.Country.Calls);
        Assert.Null(Assert.Single(h.Db.Users).Country);
    }

    // ------------------------------------------------------- fixtures

    private static HttpGeoIpLookup Lookup(StubHttpMessageHandler handler)
        => new(
            new HttpClient(handler),
            new GeoSettings { LookupUrl = "https://geo.test/{ip}/country/" },
            NullLogger<HttpGeoIpLookup>.Instance);

    private static LoginCommandHandler Login(TestHarness h)
        => new(h.Db, h.Hasher, h.TokenIssuer, h.Tokens, h.Clock, h.Country, h.Email, h.QuotaGate);

    private static async Task<User> Seed(TestHarness h)
    {
        var user = User.Create("Grace Hopper", "grace@example.com", h.Hasher.Hash("s3cretpw!"), h.Clock.UtcNow);
        h.MarkEmailVerified(user);
        h.Db.Users.Add(user);
        await h.Db.SaveChangesAsync();
        return user;
    }
}
