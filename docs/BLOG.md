# Blog and hymn pages

notefusion.studio has a blog at **/blog** and public-domain hymns in Tonic Solfa at **/hymns**.
Both are plain static pages, generated from files in `content/` and committed to `web-site/`, so
Vercel keeps serving the folder as it is and every pull request shows exactly what will go live.

```
content/
  blog/<slug>.md            a post: YAML front matter + Markdown → /blog/<slug>
  blog/topics.yml           the queue of topics the drafter works through
  authors/francis.md        the author page (/blog/author/francis) and the byline
  hymns/<slug>.json         a hymn's words, credits and public-domain facts → /hymns/<slug>
  hymns/tunes/<tune>.json   a tune's melody (one tune can carry several hymns)
tools/blog/
  build.mjs                 content/ → web-site/blog, web-site/hymns, sitemap.xml, the home-page strip
  check.mjs                 CI: fails if the committed pages are stale, a link is broken, JSON-LD is invalid…
  draft.mjs                 drafts the next topic with the Gemini API
  indexnow.mjs              pings IndexNow after a deploy
web-site/assets/blog.css    styles for the generated pages
web-site/assets/hymn.js     staff (OSMD) and piano on hymn pages; the solfa itself needs no JavaScript
```

**Never edit `web-site/blog/**`, `web-site/hymns/**` or the latest-posts block in
`web-site/index.html` by hand.** Edit `content/`, then rebuild:

```bash
cd tools/blog && npm ci         # once
node tools/blog/build.mjs       # from the repo root: regenerate the pages
node tools/blog/check.mjs       # what CI runs: staleness, links, JSON-LD, sitemap, feed
cd tools/blog && npm test       # generator tests
python3 -m http.server -d web-site 8000    # preview at http://localhost:8000/blog/
```

The `Blog & hymn pages` workflow (`.github/workflows/blog-check.yml`) runs the tests and the check
on every pull request that touches `content/`, `tools/blog/` or `web-site/`.

## How posts are drafted

Twice a week — **Monday and Thursday at 06:30 Lagos time** — the `Draft a blog post` workflow
(`.github/workflows/blog-draft.yml`):

1. takes the first topic in `content/blog/topics.yml` that has no post yet and no open draft
   branch (`blog/<slug>`);
2. asks the Gemini API for the post as structured JSON (title, description, slug, tags, FAQ,
   Markdown body), with NoteFusion's rules in the system instruction;
3. runs the **quality checks** (`tools/blog/lib/quality.mjs`): title ≤ 60 characters, description
   110–155, 1,200–2,200 words, at least four sections, no `#` heading in the body, 3–8 FAQ answers,
   the topic's required links and a link to `/app` present, every internal link resolving, no
   external links, no stock AI phrases ("as an AI", "delve"…), no placeholders (TODO, lorem…), no
   percentages, "studies show", attributed quotes or testimonials, no solfa written by hand, and
   every solfa block buildable. If anything fails it sends the list back for **one** revision; if
   the revision still fails, the job fails loudly and no pull request is opened;
4. writes `content/blog/<slug>.md`, rebuilds the pages, runs the check, and opens a pull request
   **"Blog draft: <title>"** from `blog/<slug>` with the target keyword, a review checklist, and
   the token usage of each API call.

The workflow never pushes to `main`. **Nothing is published until you merge.** You can also run it
by hand: Actions → *Draft a blog post* → *Run workflow*, optionally with a topic slug or a model.

### The rules the model is given

The system instruction (`tools/blog/lib/prompt.mjs`) tells the model to write as Francis, for
choirs in Nigeria and West Africa that read movable-doh, la-based-minor Tonic Solfa, and that it
must never invent statistics, studies, quotes, testimonials or anecdotes; must link only to pages
on this site; may describe only the NoteFusion features it is given; and must never mention prices.

**Solfa is never written by the model.** The drafter computes a catalogue of examples with
NoteFusion's engine (`web-site/assets/choir.js`) — each hymn's opening line exactly as the engine
writes it, and the scales — and the model can only cite them as ` ```solfa ` blocks, which the
build renders with the engine. A run of hand-written solfa in the prose fails the quality check.

### Model, key and cost

| Setting | Where | Default |
|---|---|---|
| `GEMINI_API_KEY` (**required**) | Settings → Secrets and variables → Actions → *Secrets* | — |
| `GEMINI_MODEL` | Settings → Secrets and variables → Actions → *Variables* (or the run's *model* input) | `gemini-3.8-flash` |
| `GEMINI_MAX_OUTPUT_TOKENS` | env when running `draft.mjs` locally | `16384` |

`gemini-3.8-flash` is Google's current stable Flash model: cheap and a good writer. For higher
quality set `GEMINI_MODEL` to a Pro model — at the time of writing `gemini-3.1-pro-preview`. The
older `gemini-2.5-pro` and `gemini-2.5-flash` are only served to accounts that already used them.
Check the [model list](https://ai.google.dev/gemini-api/docs/models) when you change it.

The call is plain `fetch` to
`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` with the key in
the `x-goog-api-key` header, `responseMimeType: application/json` and a `responseSchema`,
temperature 0.7. A 429, a 5xx or a dropped connection is retried once after a pause; anything
else fails with the API's own message. Thinking tokens count against the output limit, which is
why it is 16,384 rather than 8,192; a draft cut off by the limit fails rather than half-writes.

**Cost:** each call's `usageMetadata` (prompt, output, thinking and total tokens) is printed in the
job log and tabulated in the pull request. Multiply by the rates on Google's
[Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing). A draft is one call, or
two when a revision is needed.

If the secret is missing, the job stops at its first step with an error saying so; nothing is drafted.

### One-time GitHub setup

1. **Add the secret.** Settings → Secrets and variables → Actions → *New repository secret* →
   name `GEMINI_API_KEY`, value a key from [Google AI Studio](https://aistudio.google.com/apikey).
2. **Let the workflow open pull requests.** Settings → Actions → General → *Workflow permissions*
   → tick **Allow GitHub Actions to create and approve pull requests**. Without it the push
   succeeds but `gh pr create` is refused.
3. Optionally add the `GEMINI_MODEL` variable.

Pull requests opened with the workflow's own token do not trigger other workflows, so the *Blog &
hymn pages* check does not run on the bot's first commit (the drafter already ran the same check
before pushing). It runs as soon as you push an edit to the branch.

## Reviewing and publishing a draft

1. Open the pull request. Read the post in *Files changed* (`content/blog/<slug>.md`), or preview
   it: check out the branch and run `python3 -m http.server -d web-site 8000`. The deploy workflow
   only deploys `main`; if Vercel's GitHub integration is connected, its preview link appears on
   the pull request as well.
2. Work through the checklist: facts right, your voice, the solfa examples where they belong, a
   title and description that read well in Google, FAQ answers worth having.
3. To change it, edit `content/blog/<slug>.md` on the branch (on GitHub, the pencil icon), then
   rebuild and commit: `node tools/blog/build.mjs` (the check fails until the pages match).
   You can also set `date:` to the day you publish.
4. **Merge.** The merge deploys the site (`deploy-web.yml`), and the deploy pings IndexNow with
   the new and changed pages.
5. To drop a topic: close the pull request, delete the branch, and add `skip: true` to the topic in
   `topics.yml` (otherwise it is drafted again).

To hold a finished post back without deleting it, set `draft: true` in its front matter: the build
leaves it out.

## Writing a post by hand

Create `content/blog/<slug>.md` (the file name is the URL — never change it after publishing):

```yaml
---
title: "How to Find the Doh of Any Song"          # ≤ 60 characters is best for Google
description: "Three reliable ways to find…"        # ≤ 160 characters (aim for 120–155)
date: "2026-10-14"
updated: "2026-11-02"                              # optional; shown and used as lastmod
author: francis                                    # content/authors/<id>.md
tags: [tonic-solfa, keys]                          # lowercase-hyphenated
keyword: how to find the doh of a song             # optional, for your own tracking
hymns: [amazing-grace]                             # optional; also picked up from solfa blocks
cover: { src: /assets/blog/doh.jpg, alt: "…", width: 1200, height: 630 }   # optional; also the social card
faq:                                               # optional; rendered at the end + FAQPage JSON-LD
  - q: "Is doh always the first note?"
    a: "No. …"
draft: false
---
Markdown body. Start sections at ## (the title is the page's only h1).
```

Images: `![alt text](/assets/blog/picture.jpg "1200x675")` — the size in the title is required so
the page does not jump as the image loads; images are lazy-loaded.

Solfa examples are ` ```solfa ` blocks, rendered by NoteFusion's engine:

````markdown
```solfa
hymn: amazing-grace     # any published hymn
bars: 1-5               # optional; the pickup bar counts as bar 1
key: F major            # optional; the same bars in another key (the solfa does not change)
words: false            # optional
```

```solfa
scale: A minor          # any major or minor key
harmonic: true          # optional: the raised seventh (se)
```
````

Each post gets: a table of contents (from four sections up), reading time, the byline and author
box, related posts by tag, the hymns it cites, the "Transcribe your own song" call to action,
canonical URL, Open Graph and Twitter cards (the default card unless the post has a `cover`),
`BlogPosting`, `BreadcrumbList` and `FAQPage` JSON-LD, and an entry in the sitemap and the RSS feed
(`/blog/feed.xml`). Tag pages are `noindex` (they only repeat summaries) and stay out of the sitemap.

## Adding a topic

Add an entry to `content/blog/topics.yml`, higher up to draft it sooner:

```yaml
  - slug: how-to-sing-alto                     # the URL; lowercase-hyphenated, unique
    keyword: "how to sing alto in a choir"     # the search phrase the post answers
    intent: "How-to — new altos who keep drifting to the tune."
    angle: "Finding your part against the soprano line, practising with solfa, listening to the bass."
    links: [/blog/satb-parts-explained, /hymns]    # pages the post must link to (/app is always required)
```

Quote values that contain a colon. A required link to a post that is not published yet is simply
not required until it is. There are no search-volume numbers in the file on purpose: once the blog
has impressions, use Search Console's *Performance* report to reorder the queue.

## Hymns

Each hymn page shows the doh, the solfa in the web app's hymn layout with the first verse under it,
the same solfa as plain text line by line, the staff (MusicXML drawn by the pinned OSMD, the same
file and SRI hash as `/app`), every verse, a piano player that lights the note being played, facts
read off the melody (starting note, range, the notes it uses), a short history, credits, three
questions with answers, and `MusicComposition` + `BreadcrumbList` + `FAQPage` JSON-LD.

**All solfa comes from the engine.** The hymn files hold pitches and durations; the build runs
`web-site/assets/choir.js` — the web mirror of `src/NoteFusion.Core/Solfa` — on them. Correct a
hymn by correcting its notes, never by typing solfa.

### Public domain, strictly

The build refuses to publish a hymn unless **everyone named (composer, arranger, author,
translator) died before 1955** — or the source is marked `"traditional": true` — and **both words
and music were first published before 1929**. That keeps every page out of copyright in Nigeria
(life + 70 years), the UK and EU (life + 70) and the United States (published before 1929).
Do not add hymns whose words or tune are still in copyright (for example the English words of
*How Great Thou Art*, *Great Is Thy Faithfulness*, or modern worship songs); note that a modern
arrangement or translation of an old hymn can still be protected.

### Status of the seeded hymns

Every hymn is `"reviewed": false` until you have checked the melody against a hymn book you trust;
change it to `true` when you have. Published now (melodies encoded by hand; please check):

| Hymn | Tune | Key | Confidence / what to check |
|---|---|---|---|
| Amazing Grace | NEW BRITAIN | G | High. "me" is held five beats, as most books print it. |
| Praise God, from Whom All Blessings Flow | OLD HUNDREDTH | G | High for the notes; the even-note barring is one of several in print. |
| All People That on Earth Do Dwell | OLD HUNDREDTH | G | As above (same tune). |
| Be Present at Our Table, Lord | OLD HUNDREDTH | G | As above (same tune). |
| Joyful, Joyful, We Adore Thee | HYMN TO JOY | G | High. |
| Silent Night | STILLE NACHT | Bb | High for the notes; check the word underlay of the last two lines. |
| Good King Wenceslas | TEMPUS ADEST FLORIDUM | G | High for the notes; check the underlay of the final "fuel". |

Seeded as **drafts** (words and credits in place, **no melody yet**, so not published):
Holy, Holy, Holy (NICAEA), Abide with Me (EVENTIDE), What a Friend We Have in Jesus (CONVERSE),
It Is Well with My Soul (VILLE DU HAVRE), Blessed Assurance (ASSURANCE). Their melodies were not
encoded because they could not be written down from memory with enough confidence; add them from
your hymn book as below, then set `"draft": false`.

### Adding or correcting a hymn

1. **The tune** — `content/hymns/tunes/<tune>.json`:

   ```json
   {
     "name": "NEW BRITAIN",
     "music": [{ "name": "Edwin O. Excell", "born": 1851, "died": 1921, "role": "Arranged (1900)" }],
     "musicPublished": 1829,
     "key": "G major",
     "time": "3/4",
     "tempo": 76,
     "pickup": 1,
     "lineBars": 4,
     "melody": "D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | …",
     "reviewed": false,
     "reviewNotes": "what to check"
   }
   ```

   The melody is `PITCH:BEATS` with `|` between bars: pitches as `G4`, `F#4`, `Bb3` (C4 is middle
   C), beats in crotchets (`1` a crotchet, `.5` a quaver, `1.5` a dotted crotchet, `3` a dotted
   minim), `r:1` a rest, and a trailing `~` ties a note into the next one of the same pitch (a note
   held over a bar line). Every bar must add up; a `pickup` bar holds that many beats and the last
   bar the rest of a bar. Notes must fall on the half-beat grid the solfa layout uses, so tunes
   with semiquavers or dotted-quaver rhythms cannot be shown yet. `lineBars` is how many bars go on
   a line of the solfa grid (a number, or a list such as `[2, 2, 2, 3]`); two suits 4/4 tunes.

   A quick way to get the notes: sing or play the tune into NoteFusion and copy the pitches from
   the sheet, then check them against the book.

2. **The hymn** — `content/hymns/<slug>.json` (the file name is the URL):

   ```json
   {
     "title": "Amazing Grace",
     "tune": "new-britain",
     "text": [{ "name": "John Newton", "born": 1725, "died": 1807, "role": "Words, Olney Hymns (1779)" }],
     "textPublished": 1779,
     "description": "≤ 160 characters for search results",
     "about": ["A paragraph of history: only facts you are sure of."],
     "underlay": "A-maz-ing_ grace! how sweet the sound, …",
     "verses": [{ "lines": ["Amazing grace! how sweet the sound", "…"] }, { "label": "Refrain", "lines": ["…"] }],
     "updated": "2026-10-15",
     "reviewed": false,
     "draft": false
   }
   ```

   `underlay` is the first verse split into one syllable per note: hyphens join the syllables of a
   word (`A-maz-ing`), and `_` after a syllable carries it over one more note (`ing_` is sung on two
   notes). The build fails if the syllables and notes do not match one for one. Optional:
   `"shortTitle"` (used in the page title), `"note"` on a verse.

3. Rebuild, check, preview, commit: `node tools/blog/build.mjs && node tools/blog/check.mjs`.

## Getting found: Search Console, Bing and IndexNow

Google no longer accepts sitemap "pings"; it reads `robots.txt` (which points at
`https://notefusion.studio/sitemap.xml`) and whatever you submit in Search Console. Do this once:

**Google Search Console**
1. Go to [search.google.com/search-console](https://search.google.com/search-console) → *Add
   property* → **Domain** → `notefusion.studio`.
2. Google shows a TXT record (`google-site-verification=…`). Add it to the domain's DNS — if the
   domain's DNS is on Vercel: Vercel dashboard → *Domains* → `notefusion.studio` → *DNS Records* →
   add a `TXT` record for `@` with that value. Back in Search Console, click *Verify* (DNS can take
   a few minutes to an hour).
3. *Sitemaps* → enter `sitemap.xml` → *Submit*. The status should become "Success" with the
   discovered pages.
4. *URL inspection* → paste `https://notefusion.studio/blog` and `https://notefusion.studio/hymns`
   → *Request indexing*. Do the same for a new post on publishing day if you are in a hurry.
5. Over the following weeks: *Pages* shows what is indexed and why anything is not; *Performance*
   shows the searches people find you with — use it to reorder `topics.yml`; the
   *Enhancements* reports show whether the structured data (breadcrumbs and the like) is valid.

**Bing Webmaster Tools** (Bing's index is also used by other search services)
1. Go to [bing.com/webmasters](https://www.bing.com/webmasters) and sign in.
2. Choose **Import from Google Search Console** (quickest — it brings the verified site and the
   sitemap), or add `https://notefusion.studio` and verify it with the DNS record it gives you.
3. Check *Sitemaps* lists `https://notefusion.studio/sitemap.xml`.

**IndexNow** is automatic. After each deploy of `main`, `deploy-web.yml` runs
`tools/blog/indexnow.mjs`, which lists the blog and hymn pages added, changed or removed since the
previous commit and posts them to `api.indexnow.org` with the site's key. Bing, Yandex, Seznam,
Naver and the other IndexNow engines recrawl them within hours (Google does not use IndexNow). The
key is the public file `web-site/<key>.txt`, written by the build from `INDEXNOW_KEY` in
`tools/blog/lib/site.mjs`; Bing Webmaster Tools → *IndexNow* shows the URLs it received. A failed
ping is a warning in the deploy log, never a failed deploy.

## Notes on the implementation

- **Headers and CSP.** The marketing pages' enforced CSP sets only `object-src`, `base-uri` and
  `frame-ancestors`, so the JSON-LD and JSON data blocks (which are data, not executed) and the
  scripts load as on the other public pages. The Report-Only policy now also lists the pinned OSMD
  URL, so drawing the staff on hymn pages does not produce reports.
- **Speed.** Pages are static HTML with the site's existing Inter font and stylesheets; the solfa
  is text; the only scripts are the first-party tracker, AdSense (as on the other public pages),
  and on hymn pages `choir.js` + `hymn.js` (deferred), which load OSMD only when the staff scrolls
  into view and create the audio context only when Play is pressed. Images need a width and height.
  To keep ads off the blog and hymn pages, set `ADSENSE_CLIENT` to `null` in
  `tools/blog/lib/site.mjs` and rebuild.
- **Analytics.** Every generated page loads `assets/track.js`, so blog and hymn traffic appears in
  the admin dashboard's *Website traffic*; the call-to-action buttons are named for click tracking
  ("CTA: blog", "CTA: hymn"), and playing a hymn records the action "Hymn played".
- **Updating the shared assets.** `vercel.json` makes browsers revalidate `/assets/*.css` and
  `*.js` on every load, but follow the site's convention anyway: bump the `?v=` numbers in
  `ASSET_VERSION` (`tools/blog/lib/site.mjs`) and rebuild when you change `blog.css` or `hymn.js`.
