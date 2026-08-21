using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Admin.Services;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Geo;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The audit trail. Everything an admin can do to someone else's account writes here, so the trail is the
/// only thing standing between "an operator fixed a support ticket" and "an account was changed and nobody
/// knows by whom". Two properties matter more than the rest: a row has to stay readable after the accounts
/// it names are gone, and it has to be impossible for an audited action to commit without its row.
/// </summary>
public class AuditTrailTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 9, 30, 0, DateTimeKind.Utc);

    [Fact]
    public void A_recorded_action_snapshots_the_actor_the_target_and_the_address()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        // The address arrives the way production produces it: through the same forwarded-chain rule the
        // request-scoped resolver uses, so what is asserted here is the value the trail would really store
        // behind Heroku's router rather than a string invented for the test.
        h.ClientIp.Current = ClientIpAddress.Resolve("41.58.1.1, 102.89.23.7", "10.0.0.1", trustedProxyHops: 1);

        h.AuditAs(admin).Record(AdminAuditAction.GiftPro, target, "Gifted Pro for 1 month.", "Compensation for the outage.");
        h.Db.SaveChanges();

        var entry = Assert.Single(h.Db.AdminAuditLogs);
        Assert.Equal(admin.Id, entry.ActorUserId);
        Assert.Equal("ada@notefusion.studio", entry.ActorEmail);
        Assert.Equal(AdminAuditAction.GiftPro, entry.Action);
        Assert.Equal(target.Id, entry.TargetUserId);
        Assert.Equal("pat@example.com", entry.TargetEmail);
        Assert.Equal("102.89.23.7", entry.IpAddress);
        Assert.Equal("Gifted Pro for 1 month.", entry.Summary);
        Assert.Equal("Compensation for the outage.", entry.Note);
        Assert.Equal(Now, entry.OccurredAtUtc);
    }

    [Fact]
    public void The_row_still_names_both_parties_after_the_accounts_are_deleted()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        h.AuditAs(admin).Record(AdminAuditAction.SuspendUser, target, "Suspended the account.");
        h.Db.SaveChanges();

        // The reason the emails are copied into the row instead of joined at display time. A GDPR erasure
        // or a departing admin must not take the readable half of the history with it — and there are no
        // foreign keys here, so the delete is not blocked either.
        h.Db.Users.Remove(admin);
        h.Db.Users.Remove(target);
        h.Db.SaveChanges();

        var entry = Assert.Single(h.Db.AdminAuditLogs);
        Assert.Equal("ada@notefusion.studio", entry.ActorEmail);
        Assert.Equal("pat@example.com", entry.TargetEmail);
    }

    [Fact]
    public void An_unknown_address_is_recorded_as_unknown_rather_than_as_loopback()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        // A local run, a compose run, or a background job. The resolver keeps only publicly routable
        // addresses, so this is the normal state off Heroku — and "we do not know" is a different fact from
        // "the request came from this machine". The dashboard renders null as "—".
        h.AuditAs(admin).Record(AdminAuditAction.ReactivateUser, target, "Reactivated the account.");
        h.Db.SaveChanges();

        Assert.Null(Assert.Single(h.Db.AdminAuditLogs).IpAddress);
    }

    [Fact]
    public void A_blank_note_is_stored_as_no_note()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        // The dashboard sends "" for an untouched optional field. Storing that would make the log page
        // render an empty reason box, which reads as "they gave a reason and it was nothing".
        h.AuditAs(admin).Record(AdminAuditAction.RevokePro, target, "Revoked the gifted Pro.", "   ");
        h.Db.SaveChanges();

        Assert.Null(Assert.Single(h.Db.AdminAuditLogs).Note);
    }

    [Fact]
    public void Recording_stages_the_row_without_committing_it()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        h.AuditAs(admin).Record(AdminAuditAction.EndSubscription, target, "Ended the subscription.");

        // The contract that makes an unlogged action impossible: the row rides the caller's single
        // SaveChangesAsync, so the effect and its log entry commit together or neither does. If Record
        // saved on its own, a handler that failed afterwards would leave a log of something that never
        // happened. The query goes to the database, which is why an added-but-unsaved row is invisible.
        Assert.Empty(h.Db.AdminAuditLogs.AsNoTracking().ToList());
    }

    [Fact]
    public void Writing_the_trail_outside_a_request_is_a_wiring_mistake()
    {
        using var h = new TestHarness(Now);
        var (_, target) = Seed(h);

        var logger = new AuditLogger(h.Db, new StubCurrentUser(null), h.ClientIp, h.Clock);

        // Every caller sits behind the Admin policy, so there is no legitimate anonymous path here.
        // Failing loudly beats writing an actorless row that answers nobody's question.
        Assert.Throws<InvalidOperationException>(
            () => logger.Record(AdminAuditAction.GiftPro, target, "Gifted Pro."));
    }

    // ------------------------------------------------------------------ the log page

    [Fact]
    public async Task The_log_reads_newest_first_and_pages()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        var audit = h.AuditAs(admin);

        for (var i = 0; i < 5; i++)
        {
            h.Clock.UtcNow = Now.AddMinutes(i);
            audit.Record(AdminAuditAction.SuspendUser, target, $"Action {i}.");
        }

        h.Db.SaveChanges();

        var first = await Query(h, new GetAuditLogQuery(Page: 1, PageSize: 2));

        Assert.Equal(5, first.TotalCount);
        Assert.Equal(3, first.TotalPages);
        Assert.Equal(new[] { "Action 4.", "Action 3." }, first.Items.Select(i => i.Summary).ToArray());

        var last = await Query(h, new GetAuditLogQuery(Page: 3, PageSize: 2));
        Assert.Equal(new[] { "Action 0." }, last.Items.Select(i => i.Summary).ToArray());
    }

    [Fact]
    public async Task Overshooting_the_last_page_is_an_empty_page_not_an_error()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        h.AuditAs(admin).Record(AdminAuditAction.ChangeRole, target, "Made admin.");
        h.Db.SaveChanges();

        // A paging control that runs off the end is a normal thing for a UI to do; turning it into an
        // error state would make the log page break on a stale click.
        var page = await Query(h, new GetAuditLogQuery(Page: 99, PageSize: 25));

        Assert.Empty(page.Items);
        Assert.Equal(1, page.TotalCount);
    }

    [Fact]
    public async Task A_page_size_beyond_the_cap_is_clamped_rather_than_honoured()
    {
        using var h = new TestHarness(Now);
        var page = await Query(h, new GetAuditLogQuery(Page: 0, PageSize: 5_000));

        // One request must not be able to pull the whole trail, and page 0 does not exist.
        Assert.Equal(1, page.Page);
        Assert.Equal(GetAuditLogQuery.MaxPageSize, page.PageSize);
    }

    [Fact]
    public async Task The_log_filters_by_action_by_target_and_by_free_text()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        var other = User.Create("Sam Other", "sam@example.com", h.Hasher.Hash("password123"), Now.AddDays(-2));
        h.Db.Users.Add(other);

        var audit = h.AuditAs(admin);
        audit.Record(AdminAuditAction.GiftPro, target, "Gifted Pro for 1 month.");
        audit.Record(AdminAuditAction.SuspendUser, target, "Suspended the account.");
        audit.Record(AdminAuditAction.GiftPro, other, "Gifted Pro for 1 year.");
        h.Db.SaveChanges();

        var gifts = await Query(h, new GetAuditLogQuery(Action: AdminAuditAction.GiftPro));
        Assert.Equal(2, gifts.TotalCount);

        // The per-account history a detail page shows.
        var patsHistory = await Query(h, new GetAuditLogQuery(TargetUserId: target.Id));
        Assert.Equal(2, patsHistory.TotalCount);

        // Searching by an account's email is how a support thread starts, and the term is matched
        // case-insensitively without leaning on Postgres or SQLite collation.
        var bySearch = await Query(h, new GetAuditLogQuery(Search: "SAM@Example.com"));
        Assert.Equal("Gifted Pro for 1 year.", Assert.Single(bySearch.Items).Summary);

        // …and by the summary, so "who did we suspend" is answerable without knowing the enum name.
        var byText = await Query(h, new GetAuditLogQuery(Search: "suspended"));
        Assert.Single(byText.Items);
    }

    // ---------------------------------------------------------------- fixtures

    private static (User Admin, User Target) Seed(TestHarness h)
    {
        var admin = User.Create("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-200));
        admin.PromoteToAdmin();
        var target = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));

        h.Db.Users.Add(admin);
        h.Db.Users.Add(target);
        h.Db.SaveChanges();

        return (admin, target);
    }

    private static async Task<PagedResultDto<AuditLogRowDto>> Query(TestHarness h, GetAuditLogQuery query)
    {
        var result = await new GetAuditLogQueryHandler(h.Db).Handle(query, CancellationToken.None);
        Assert.True(result.IsSuccess);
        return result.Value;
    }
}
