using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Admin.Sessions;
using NoteFusion.Core.Entities;
using NoteFusion.Infrastructure.ErrorReports;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>The console's Sessions page (board k-sessions): Sentry's JSON as we read it, the page's rules and its queries.</summary>
public class SessionsTests
{
    private static readonly DateTime Now = new(2026, 10, 20, 8, 0, 0, DateTimeKind.Utc);
    private const string ReplayId = "0123456789abcdef0123456789abcdef";
    private const string ErrorId = "fedcba9876543210fedcba9876543210";

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    // ── Reading Sentry ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_replay_reads_its_person_phone_build_screens_and_errors()
    {
        var replay = SentrySessionsClient.ReadReplay(Json($$"""
            {"id":"{{ReplayId}}","project_id":"4511889593073664","started_at":"2026-10-20T07:41:00+00:00",
             "finished_at":"2026-10-20T07:47:12+00:00","duration":372,"count_errors":1,
             "user":{"id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","email":null},
             "os":{"name":"Android","version":"14"},"device":{"name":"SM-A145F","brand":"Samsung","model":"Galaxy A14","family":"Samsung"},
             "releases":["com.notefusion.com@1.0.1+43"],"urls":["Home","Record","Result"],"error_ids":["{{ErrorId}}"]}
            """));

        Assert.Equal(ReplayId, replay.Id);
        Assert.Equal(new DateTime(2026, 10, 20, 7, 41, 0, DateTimeKind.Utc), replay.StartedAt);
        Assert.Equal((372, 1), (replay.DurationSeconds, replay.ErrorCount));
        Assert.Equal("7c9e6679-7425-40de-944b-e07fc1f90ae7", replay.UserId);
        Assert.Equal("Samsung Galaxy A14", replay.Device);
        Assert.Equal("Android 14", replay.Os);
        Assert.Equal("43", SessionRules.Build(replay.Release));
        Assert.Equal(["Home", "Record", "Result"], replay.Screens);
        Assert.Equal([ErrorId], replay.ErrorIds);
    }

    [Fact]
    public void Recording_segments_give_the_video_pieces_and_what_happened_without_console_logs_or_query_strings()
    {
        var videos = new List<SentryVideoPiece>();
        var steps = new List<SentryStep>();
        SentrySessionsClient.ReadSegments(Json("""
            [[
              {"type":5,"timestamp":1792481400000,"data":{"tag":"video","payload":{"segmentId":0,"duration":5000,"container":"mp4"}}},
              {"type":5,"timestamp":1792481401000,"data":{"tag":"breadcrumb","payload":{"timestamp":1792481401.5,"category":"navigation","data":{"from":"Home","to":"Record"}}}},
              {"type":5,"timestamp":1792481402000,"data":{"tag":"breadcrumb","payload":{"timestamp":1792481402,"category":"ui.tap","message":"Record button"}}},
              {"type":5,"timestamp":1792481403000,"data":{"tag":"breadcrumb","payload":{"timestamp":1792481403,"category":"console","message":"[log] noisy"}}}
            ],[
              {"type":5,"timestamp":1792481405000,"data":{"tag":"video","payload":{"segmentId":1,"duration":4800}}},
              {"type":5,"timestamp":1792481406000,"data":{"tag":"performanceSpan","payload":{"op":"resource.http","description":"https://api.notefusion.studio/api/transcriptions?token=secret","startTimestamp":1792481406.2,"endTimestamp":1792481406.9,"data":{"method":"POST","statusCode":201}}}},
              {"type":3,"timestamp":1792481407000,"data":{"source":2}}
            ]]
            """), videos, steps);

        Assert.Equal([0, 1], videos.Select(v => v.SegmentId));
        Assert.Equal(DateTime.UnixEpoch.AddMilliseconds(1792481405000), videos[1].StartsAt);
        Assert.Equal(4800, videos[1].DurationMs);

        Assert.Equal(
            [("screen", "Record"), ("tap", "Tapped Record button"), ("request", "POST /api/transcriptions → 201")],
            steps.Select(s => (s.Kind, s.Text)));
        Assert.Equal(DateTime.UnixEpoch.AddMilliseconds(1792481401500), steps[0].At);

        // Sentry may also wrap the segments in "data".
        var wrapped = new List<SentryVideoPiece>();
        SentrySessionsClient.ReadSegments(Json("""{"data":[[{"type":5,"timestamp":1,"data":{"tag":"video","payload":{"segmentId":3,"duration":10}}}]]}"""), wrapped, []);
        Assert.Equal(3, Assert.Single(wrapped).SegmentId);
    }

    [Fact]
    public void An_error_event_keeps_its_own_frames_innermost_first()
    {
        var e = SentrySessionsClient.ReadErrorEvent(Json($$$"""
            {"eventID":"{{{ErrorId}}}","title":"TypeError: Cannot read properties of undefined (reading 'notes')","dateCreated":"2026-10-20T07:44:41Z",
             "entries":[{"type":"exception","data":{"values":[{"type":"TypeError","stacktrace":{"frames":[
               {"function":"render","filename":"node_modules/react-native/Renderer.js","lineNo":10,"inApp":false},
               {"function":"PracticeView","filename":"src/screens/result/PracticeView.tsx","lineNo":212,"inApp":true},
               {"function":"partLine","filename":"src/lib/practice.ts","lineNo":118,"inApp":true}]}}]}}]}
            """))!;

        Assert.Equal(ErrorId, e.Id);
        Assert.StartsWith("TypeError", e.Title);
        Assert.Equal(["at partLine (src/lib/practice.ts:118)", "at PracticeView (src/screens/result/PracticeView.tsx:212)"], e.Frames);
    }

    [Fact]
    public void An_issue_reads_its_count_written_as_a_string_and_its_project()
    {
        var issue = SentrySessionsClient.ReadIssue(Json("""
            {"id":"6012","title":"Timeout reading job","culprit":"GetTranscriptionJobQuery","count":"14","userCount":6,
             "firstSeen":"2026-10-20T06:12:00Z","lastSeen":"2026-10-20T07:57:00Z","permalink":"https://fransix.sentry.io/issues/6012/",
             "project":{"id":"42","slug":"notefusion-api","platform":"csharp"}}
            """));
        Assert.Equal(("6012", 14, 6, "42"), (issue.Id, issue.Count, issue.UserCount, issue.ProjectId));
    }

    [Fact]
    public void An_events_recording_is_read_from_its_replay_context_or_its_tag()
    {
        Assert.Equal(ReplayId, SentrySessionsClient.ReplayIdOf(Json("{\"contexts\":{\"replay\":{\"replay_id\":\"" + ReplayId + "\"}}}")));
        Assert.Equal(ReplayId, SentrySessionsClient.ReplayIdOf(Json($$"""{"tags":[{"key":"level","value":"error"},{"key":"replayId","value":"{{ReplayId}}"}]}""")));
        Assert.Null(SentrySessionsClient.ReplayIdOf(Json("""{"tags":[]}""")));
    }

    [Fact]
    public void The_next_page_is_the_link_headers_next_cursor_only_while_it_says_there_are_results()
    {
        using var more = new HttpResponseMessage(HttpStatusCode.OK);
        more.Headers.Add("Link",
            "<https://sentry.io/api/0/x/?cursor=0:0:1>; rel=\"previous\"; results=\"false\"; cursor=\"0:0:1\", "
            + "<https://sentry.io/api/0/x/?cursor=0:25:0>; rel=\"next\"; results=\"true\"; cursor=\"0:25:0\"");
        Assert.Equal("0:25:0", SentrySessionsClient.NextCursor(more));

        using var last = new HttpResponseMessage(HttpStatusCode.OK);
        last.Headers.Add("Link", "<https://sentry.io/api/0/x/?cursor=0:50:0>; rel=\"next\"; results=\"false\"; cursor=\"0:50:0\"");
        Assert.Null(SentrySessionsClient.NextCursor(last));
    }

    // ── The page's rules ────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("react-native", "Phone")]
    [InlineData("csharp", "API")]
    [InlineData("dotnet-aspnetcore", "API")]
    [InlineData("python-fastapi", "Worker")]
    [InlineData("javascript", "Web")]
    public void Each_projects_errors_are_labelled_by_where_they_came_from(string platform, string source)
        => Assert.Equal(source, SessionRules.Source(platform));

    [Fact]
    public void A_session_is_recording_now_while_its_last_piece_is_under_ninety_seconds_old()
    {
        SentryReplay Last(TimeSpan ago) => new(ReplayId, "1", Now.AddMinutes(-5), Now - ago, 300, 0, null, null, null, null, [], []);
        Assert.True(SessionRules.RecordingNow(Last(TimeSpan.FromSeconds(40)), Now));
        Assert.False(SessionRules.RecordingNow(Last(TimeSpan.FromMinutes(3)), Now));
    }

    [Fact]
    public void A_request_sentry_noted_twice_is_one_line_with_its_status()
    {
        var merged = SessionRules.MergeRequests(
        [
            new SessionStepDto(1000, "request", "GET /api/me"),
            new SessionStepDto(1200, "screen", "Home"),
            new SessionStepDto(1400, "request", "GET /api/me → 401"),
            new SessionStepDto(1500, "request", "POST /api/transcriptions → 201"),
            // The same request again a while later is a request of its own.
            new SessionStepDto(9000, "request", "GET /api/me → 200"),
        ]);

        Assert.Equal(
            [(1000, "GET /api/me → 401"), (1200, "Home"), (1500, "POST /api/transcriptions → 201"), (9000, "GET /api/me → 200")],
            merged.Select(s => (s.AtMs, s.Text)));
    }

    [Theory]
    [InlineData("0123456789abcdef0123456789abcdef", true)]
    [InlineData("../../organizations/other/", false)]
    [InlineData("0123456789ABCDEF0123456789ABCDEF", false)]
    public void Only_a_sentry_id_reaches_a_url(string id, bool ok) => Assert.Equal(ok, SessionRules.IsSentryId(id));

    [Fact]
    public void Only_admins_reach_the_sessions_routes()
    {
        var authorize = typeof(AdminSessionsController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(AuthorizationPolicies.Admin, authorize?.Policy);
        Assert.DoesNotContain(typeof(AdminSessionsController).GetMethods(), m => m.GetCustomAttribute<AllowAnonymousAttribute>() is not null);
    }

    // ── The queries ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Recordings_carry_whose_they_are_from_our_own_accounts()
    {
        using var h = new TestHarness(Now);
        var ada = User.Create("Ada Obi", "ada.obi@example.com", h.Hasher.Hash("pass"), Now);
        h.Db.Users.Add(ada);
        await h.Db.SaveChangesAsync();
        var sentry = new FakeSentry
        {
            Replays =
            [
                new(ReplayId, "1", Now.AddMinutes(-3), Now.AddSeconds(-20), 160, 0, ada.Id.ToString(), "Tecno Spark 10", "Android 13",
                    "com.notefusion.com@1.0.1+43", ["Home", "Record"], []),
                new(ErrorId, "1", Now.AddHours(-1), Now.AddMinutes(-55), 65, 1, null, "itel A70", "Android 13", null, ["Onboarding"], []),
            ],
        };

        var page = await Handlers(h, sentry).Handle(new GetSessionRecordingsQuery(false, null), CancellationToken.None);

        Assert.True(page.IsSuccess);
        var live = page.Value.Items[0];
        Assert.Equal(("Ada Obi", "ada.obi@example.com"), (live.Person!.Name, live.Person.Email));
        Assert.Equal(("notefusion-mobile", "43", true), (live.Project, live.Build, live.RecordingNow));
        var signedOut = page.Value.Items[1];
        Assert.Null(signedOut.Person);
        Assert.False(signedOut.RecordingNow);
    }

    [Fact]
    public async Task A_recording_places_its_pieces_steps_and_errors_on_its_own_clock()
    {
        using var h = new TestHarness(Now);
        var start = Now.AddMinutes(-10);
        var sentry = new FakeSentry
        {
            Replays = [new(ReplayId, "1", start, start.AddMinutes(6), 372, 1, null, null, null, null, [], [ErrorId])],
            Recording = new SentryRecording(
                [new SentryVideoPiece(1, start.AddSeconds(5), 5000), new SentryVideoPiece(0, start, 5000)],
                [new SentryStep(start.AddSeconds(12), "tap", "Tapped Record")]),
            Errors = { [ErrorId] = new SentryErrorEvent(ErrorId, start.AddSeconds(221), "TypeError", ["at partLine (src/lib/practice.ts:118)"]) },
        };

        var detail = (await Handlers(h, sentry).Handle(new GetSessionRecordingQuery(ReplayId), CancellationToken.None)).Value;

        Assert.Equal([(0, 0), (1, 5000)], detail.Videos.Select(v => (v.SegmentId, v.StartMs)));
        Assert.Equal(12000, Assert.Single(detail.Steps).AtMs);
        Assert.Equal(221000, Assert.Single(detail.Errors).AtMs);
        Assert.Equal($"https://fransix.sentry.io/replays/{ReplayId}/", detail.SentryUrl);
    }

    [Fact]
    public async Task A_video_is_fetched_only_from_a_project_of_this_organisation()
    {
        using var h = new TestHarness(Now);
        var sentry = new FakeSentry();
        var handlers = Handlers(h, sentry);

        var other = await handlers.Handle(new GetSessionVideoQuery(ReplayId, "someone-elses", 0), CancellationToken.None);
        Assert.Equal("SESSION_NOT_FOUND", other.Error.Code);
        var ours = await handlers.Handle(new GetSessionVideoQuery(ReplayId, "notefusion-mobile", 0), CancellationToken.None);
        Assert.True(ours.IsSuccess);
        Assert.Equal([("notefusion-mobile", 0)], sentry.VideosRead);
    }

    [Fact]
    public async Task Errors_are_labelled_by_source_and_filtered_to_one()
    {
        using var h = new TestHarness(Now);
        var sentry = new FakeSentry
        {
            Issues =
            [
                new("1", "TypeError", "PracticeView.tsx", "1", 14, 6, Now, Now, "https://fransix.sentry.io/issues/1/"),
                new("2", "Timeout", "GetTranscriptionJobQuery", "2", 5, 4, Now, Now, "https://fransix.sentry.io/issues/2/"),
            ],
        };
        var handlers = Handlers(h, sentry);

        var all = (await handlers.Handle(new GetSessionErrorsQuery(null), CancellationToken.None)).Value;
        Assert.Equal(["Phone", "API"], all.Select(i => i.Source));

        await handlers.Handle(new GetSessionErrorsQuery("api"), CancellationToken.None);
        Assert.Equal("2", sentry.IssuesProject);
    }

    [Fact]
    public async Task Without_a_token_the_page_says_how_to_connect_it()
    {
        using var h = new TestHarness(Now);
        var result = await Handlers(h, new FakeSentry { IsConfigured = false })
            .Handle(new GetSessionRecordingsQuery(false, null), CancellationToken.None);
        Assert.Equal("SESSIONS_NOT_CONFIGURED", result.Error.Code);
    }

    // ── The HTTP client ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_client_reads_with_its_token_and_turns_a_refusal_into_a_plain_sentence()
    {
        var stub = new StubHttpMessageHandler((request, _) => request.RequestUri!.AbsolutePath switch
        {
            "/api/0/organizations/fransix/projects/" => StubHttpMessageHandler.Respond(HttpStatusCode.OK,
                """[{"id":"1","slug":"notefusion-mobile","platform":"react-native"}]"""),
            "/api/0/projects/fransix/notefusion-mobile/replays/" + ReplayId + "/videos/2/" => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(Encoding.ASCII.GetBytes("mp4!")),
            },
            _ => StubHttpMessageHandler.Respond(HttpStatusCode.Unauthorized, """{"detail":"Invalid token"}"""),
        });
        var client = new SentrySessionsClient(
            new HttpClient(stub), new SentryApiSettings { Token = "t0ken", Org = "fransix" }, new SentryProjectsCache(),
            NullLogger<SentrySessionsClient>.Instance);

        var projects = await client.ProjectsAsync(CancellationToken.None);
        Assert.Equal("notefusion-mobile", Assert.Single(projects.Value).Slug);
        Assert.Equal("Bearer t0ken", stub.Requests[0].Headers["Authorization"]);

        Assert.Equal("mp4!", Encoding.ASCII.GetString((await client.VideoAsync("notefusion-mobile", ReplayId, 2, CancellationToken.None)).Value));

        var refused = await client.IssuesAsync(null, CancellationToken.None);
        Assert.Equal("SESSIONS_SENTRY_REFUSED", refused.Error.Code);
        Assert.DoesNotContain("Invalid token", refused.Error.Message);

        // The projects were kept: asking again sends nothing.
        var sent = stub.Requests.Count;
        await client.ProjectsAsync(CancellationToken.None);
        Assert.Equal(sent, stub.Requests.Count);
    }

    private static SessionQueryHandlers Handlers(TestHarness h, ISentrySessions sentry) => new(sentry, h.Db, h.Clock);

    private sealed class FakeSentry : ISentrySessions
    {
        public bool IsConfigured { get; init; } = true;
        public string Org => "fransix";
        public List<SentryReplay> Replays { get; init; } = [];
        public SentryRecording Recording { get; init; } = new([], []);
        public Dictionary<string, SentryErrorEvent> Errors { get; } = [];
        public List<SentryIssue> Issues { get; init; } = [];
        public string? IssuesProject { get; private set; }
        public List<(string, int)> VideosRead { get; } = [];

        private static readonly IReadOnlyList<SentryProject> Projects =
            [new("1", "notefusion-mobile", "react-native"), new("2", "notefusion-api", "csharp")];

        public Task<Result<IReadOnlyList<SentryProject>>> ProjectsAsync(CancellationToken ct) => Task.FromResult(Result.Success(Projects));

        public Task<Result<SentryReplayPage>> ReplaysAsync(bool withErrors, string? cursor, CancellationToken ct)
            => Task.FromResult(Result.Success(new SentryReplayPage(Replays.Where(r => !withErrors || r.ErrorCount > 0).ToList(), null)));

        public Task<Result<SentryReplay?>> ReplayAsync(string replayId, CancellationToken ct)
            => Task.FromResult(Result.Success(Replays.FirstOrDefault(r => r.Id == replayId)));

        public Task<Result<SentryRecording>> RecordingAsync(string projectSlug, string replayId, CancellationToken ct)
            => Task.FromResult(Result.Success(Recording));

        public Task<Result<byte[]>> VideoAsync(string projectSlug, string replayId, int segmentId, CancellationToken ct)
        {
            VideosRead.Add((projectSlug, segmentId));
            return Task.FromResult(Result.Success(new byte[] { 1 }));
        }

        public Task<Result<SentryErrorEvent?>> ErrorEventAsync(string projectSlug, string eventId, CancellationToken ct)
            => Task.FromResult(Result.Success(Errors.GetValueOrDefault(eventId)));

        public Task<Result<IReadOnlyList<SentryIssue>>> IssuesAsync(string? projectId, CancellationToken ct)
        {
            IssuesProject = projectId;
            return Task.FromResult(Result.Success<IReadOnlyList<SentryIssue>>(Issues.Where(i => projectId is null || i.ProjectId == projectId).ToList()));
        }

        public Task<Result<string?>> LatestReplayOfIssueAsync(string issueId, CancellationToken ct)
            => Task.FromResult(Result.Success<string?>(null));
    }
}
