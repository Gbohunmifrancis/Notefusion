# The X build journal

NoteFusion posts its building journey on X by itself, three times a week: one short, first-person post
from Francis about something that shipped, with a real screenshot of the product. It is a GitHub Actions
workflow, not part of the API, so it cannot touch the live product, its database or its users.

```
.github/workflows/x-build-journal.yml   the schedule, the on/off switch, the state branch
tools/social/
  run.mjs              one run: story → screenshot → words → post (or dry run)
  backlog.json         evergreen founder-journey angles, used in order when nothing new shipped
  voice.md             the style rules and example posts Gemini is given; edit it to change the tone
  fixtures/            demo data for the screenshots (Old Hundredth with its four parts)
  lib/stories.mjs      what to post about (merged PRs via the GitHub API, or local git for testing)
  lib/scenes.mjs       the screens a post can show, and which one a story gets
  lib/shoot.mjs        serves web-site/, drives Chromium against a mocked API, frames the screenshot
  lib/compose.mjs      Gemini draft → checks → one revision → template fallback
  lib/validate.mjs     the checks every post passes (length as X counts it, hashtags, hype, leaks, numbers)
  lib/x-api.mjs        media upload, alt text and the post, X API v2 with OAuth 1.0a (lib/oauth1.mjs)
```

## What a run does

1. **Picks one story.** The newest pull request merged into the default branch in the last 14 days that
   has not been posted. Ops-only PRs are skipped (CI, deploys, dependency bumps, refactors, admin-only
   work: matched on the title; put `[skip social]` in a PR's title or body to skip it by hand). Hymn-library
   import batches (`CCEH: …`) are folded into one "the library grew" post at most every 14 days. When nothing
   new shipped, the next unused item from `backlog.json`. When that is used up too, the run posts nothing.
2. **Takes a screenshot.** Builds the site (`node tools/blog/build.mjs`), serves `web-site/` on
   127.0.0.1 and opens the screen that fits the story in headless Chromium at phone size (390×844 at 2×;
   desktop only for a story about a desktop surface) against a **mocked API** that serves committed demo
   data: Amazing Grace from its own hymn page and Old Hundredth with its four parts. The account is
   "NoteFusion Demo"; nothing comes from production. Ads, analytics and Google sign-in are blocked. The
   shot is framed on the page's own background at 1080×1350 (4:5, which X shows uncropped), PNG, well under
   5 MB. The admin console is never a scene. Scenes: home, hymns-index, hymn-page, identify (the hymn finder's
   "This sounds like Amazing Grace"), app-staff, app-solfa, app-parts, practice (Learn my part),
   hymnbook ("Use the hymnbook version?"), shared-sheet.
3. **Writes the post** with Gemini (`GEMINI_MODEL`, default `gemini-3.8-flash` like the API's blog; a
   rate limit or server error is retried, then `gemini-flash-latest`) in the voice of `voice.md`, from the
   PR's title and description (or the backlog item's facts). Every draft is checked in code: at most 260
   characters as X counts them (a link is 23, an emoji 2), 0–2 hashtags, at most one emoji and one em dash,
   no mentions, no hype words, no email/IP/hostnames/config keys/tokens, no link unless links are allowed,
   and **no number the story does not state**. A failing draft gets one revision with the reasons; if it
   still fails, or Gemini is not set up, a plain template from the PR title (or the backlog item's
   `fallback`) is used. If even that fails the checks, nothing is posted.
4. **Posts it** (only when switched on): uploads the image to `POST /2/media/upload`, sets its alt text
   (`POST /2/media/metadata`, describing the screen), then `POST /2/tweets` with the media id, all signed with
   OAuth 1.0a user context. The post is never retried: if X does not answer, the story is recorded as
   possibly posted and the run fails so you can check the account. A rate limit ends the run quietly and the
   story waits for the next run; a duplicate is recorded and skipped.
5. **Remembers it** in `x-history.json` on the orphan branch **`x-journal-state`** (date, story, PRs, post
   id, text, status). Never on `main`, which would deploy. Every run, posted or not, also keeps
   `post.json` and the screenshot as a workflow artifact for 30 days.

## Schedule

Monday, Wednesday and Friday at **16:07 UTC (17:07 in Lagos)**, the one `cron:` line at the top of the
workflow: `"7 16 * * 1,3,5"`. To post daily on weekdays: `"7 16 * * 1-5"`; twice a week: `"7 16 * * 2,4"`.
GitHub runs schedules only from the default branch's copy of the workflow and may start them a few
minutes late. Off-minute times (`7`, not `0`) dodge the top-of-the-hour queue.

## Turning it on

1. **Create the X app** at [developer.x.com](https://developer.x.com), signed in **as the @NoteFusion
   account** (the access token you generate belongs to whoever is signed in, and that is who posts).
   - Create a project and an app.
   - In the app's **User authentication settings**: App permissions **Read and write**; type of app **Web
     App, Automated App or Bot**; callback URL and website `https://notefusion.studio` (required by the form,
     not used).
   - In **Keys and tokens**: copy the **API Key and Secret** (consumer keys), then generate the **Access
     Token and Secret**. Generate the access token *after* setting Read and write; one made before stays
     read-only (regenerate it if posting fails with a 403 about permissions).
2. **Pay for the API.** As of 2026 X sells API access pay-per-use from credits bought in the Developer
   Console; per X's pricing page (docs.x.com/x-api/getting-started/pricing) creating a post costs $0.015,
   and **$0.20 when the post contains a URL**, so the journal leaves links out unless you set
   `X_INCLUDE_LINKS=true`. At three posts a week that is about $0.20 a month without links (alt text may add
   a little). The free tier was closed to new developers in February 2026, and the old Basic/Pro
   subscriptions to new sign-ups; if this account still has one, it works the same. Set a spending limit in
   the console. Rate limits are far above this: `POST /2/tweets` allows 100 requests per 15 minutes per user,
   media upload 500. Check the console for current prices before buying.
3. **Add the repository secrets** (Settings → Secrets and variables → Actions → Secrets):
   `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, and `GEMINI_API_KEY` (the same
   Google AI Studio key the API's blog uses; optional, without it the plain template is posted).
4. **Dry-run it:** Actions → **X build journal** → Run workflow, with **dry_run** ticked. Open the run's
   summary for the post, and download the `x-journal-<run>` artifact for `post.json` and `shot.png`.
5. **Switch it on:** Settings → Secrets and variables → Actions → Variables → `X_POSTING_ENABLED` = `true`.
   The next scheduled run posts. To post right away: Run workflow with **dry_run** unticked.

Optional variables: `GEMINI_MODEL` (another Gemini model id), `X_INCLUDE_LINKS` (`true` allows one
notefusion.studio link at the end of a post when it helps; each such post costs $0.20).

## Steering it

- **Write about something specific now:** Run workflow with **topic** set to a backlog id
  (`learn-my-part`), a PR (`#105`), or free text ("Why I started with hymns"). Free text is the only fact
  the writer gets, so keep it factual.
- **Add angles:** append to `tools/social/backlog.json` (id, title, angle, facts, scene, optional link,
  and a `fallback` post that must pass the checks: `npm test` in `tools/social` checks every one).
- **Change the tone:** edit `tools/social/voice.md`.
- **Skip a PR:** `[skip social]` in its title or body. **Post one again / unskip:** remove its entry
  from `x-history.json` on the `x-journal-state` branch.

## Stopping it

Set `X_POSTING_ENABLED` to anything but `true` (runs carry on as dry runs, posting nothing), or disable the
workflow (Actions → X build journal → ⋯ → Disable workflow). Revoking the access token in the X console
stops it at the source.

## Running it locally

```bash
cd tools/social && npm ci && npm test              # 59 tests, no network, no browser
npx playwright-core install chromium               # once, or set PW_CHROMIUM_PATH to a Chromium
node tools/blog/build.mjs                          # from the repo root
node tools/social/run.mjs --local-git HEAD         # dry run from local merge commits → tools/social/out/
node tools/social/run.mjs --local-git --topic hum-to-find-a-hymn --scene identify
```

A local run without `GITHUB_TOKEN` reads PRs from `git log --merges` (title only, no description). Without
`GEMINI_API_KEY` it uses the template. It never posts without `--post`, `--history` and all four X secrets.
Behind an HTTPS proxy the browser cannot use (some sandboxes), run Node with `NODE_USE_ENV_PROXY=1`: the
fonts and the staff engraver are then fetched by Node.
