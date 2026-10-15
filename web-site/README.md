# NoteFusion public web

The marketing site, public policies and account self-service pages. No build step,
no framework — plain HTML, responsive CSS, and small scripts. Open `index.html` in a
browser and you are looking at production.

```
index.html            landing page
app/index.html        NoteFusion Web: sign in, paste a song link, read the sheet, rehearse, transpose, save, share, download on Pro
app/sheet/index.html  a shared sheet (?s=token): anonymous, read-only, with the rehearsal player
assets/app.js         the web app's script (API client with token refresh, polling, OSMD, PDF; guest mode for /app/?preview=<id>)
assets/preview.js     the home page's try-it-free box: link, file or a 30-second recording → an anonymous preview
assets/choir.js       movable-do labelling, hymn-book layout, voice ranges and the Web Audio rehearsal player
assets/sheet.js       the shared-sheet page's script
tests/                node --test web-site/tests/*.test.mjs (not deployed: .vercelignore)
privacy/index.html    privacy policy (unchanged from when it was hosted alone)
terms/index.html      terms of service
delete-account/       account/data deletion and email confirmation flow
reset-password/       single-use password-reset flow
blog/, hymns/         GENERATED from ../content by ../tools/blog/build.mjs — never edit; see ../docs/BLOG.md
assets/blog.css       styles for the generated blog and hymn pages
assets/hymn.js        a hymn page's staff (OSMD, lazy) and piano player
<key>.txt             the IndexNow key file (written by the build)
robots.txt            declares sitemap.xml
sitemap.xml           the public URLs; blog and hymn entries rewritten by the build, others kept
assets/theme.css      website-wide color, type, and spacing tokens
assets/landing.css    landing page structure and interactions
assets/site-refresh.css   approved blue-white landing page theme and responsive layout
assets/site-pages.css     consistent branded shell for policies and account flows
assets/landing.js     mobile menu, sample re-keying, and reveal-on-scroll
assets/pricing.js     location-aware pricing from /api/billing/public-plans
assets/mark.png       brand mark, white silhouette recoloured with a CSS mask
assets/app-onboarding.jpg  hero, front device   ┐ derived — see
assets/app-splash.jpg      hero, back device    │   ../tools/build-assets.py
assets/og-card.jpg         1200×630 social card ┘   (plus a -552.jpg each)
```

The legacy device screenshots, social share card and icons are derived from
`mobile/assets/` and should be rebuilt, not hand-edited. The script lives at the
repo root, outside the deploy root, so it is never served over the network:

```bash
python tools/build-assets.py    # needs Pillow
```

It still resizes the original app screens and draws social/share imagery. The
homepage renders a lightweight interactive sample card directly in HTML, and
the how-it-works section draws its three step illustrations as inline SVG in
`index.html` (no image downloads; they recolour with the brand tokens).

## Product preview and how it works

The homepage sample exposes the app's central visual story—Tonic Solfa, staff
notation, confidence, playback and key switching—using responsive, accessible HTML.
The three how-it-works cards use actual Home, Listening and Tonic Solfa result
screenshots, followed by short actions users can perform in the real app. When
updating the flow, replace these images with current app screenshots (do not
generate substitute app interfaces) and keep the visible sequence accurate:
start or import, record and transcribe, then review notation. The official mark
remains a repository asset tinted with a CSS mask, not AI-rendered or cropped.

Kept in `web-site/` rather than `docs/` deliberately: GitHub Pages' zero-config
option serves `docs/` wholesale, and that folder holds `NoteFusion_PRD.docx` and
`NoteFusion_TRD.docx` — publishing it would put the product requirements on the
open internet.

The admin dashboard is a separate application (`web-admin/`) with its own deploy.
This directory is public. The one signed-in page is `app/`, which talks to the API from
the browser with the same bearer-token flow as the admin dashboard; the API's CORS list
must carry the site's origin (`Cors__AllowedOrigins__1` in `docker-compose.prod.yml`).

## Design tokens

`assets/theme.css`, `assets/site-refresh.css` and `assets/site-pages.css` carry the
website's light palette, deep-navy typography, cobalt gradient and rounded white
surfaces shown in the approved page concepts. Values intentionally stay local to
the website, so product/mobile theme changes do not silently recolor the public
site; update this web palette when a web rebrand is approved.

The brand mark ships as a white silhouette with alpha. The app recolours it per
surface with React Native's `tintColor`; the web equivalent is `mask` +
`background-color`, which is what `.mark` does.

## Deploying

**Vercel** — point a project at this directory.

```bash
npx vercel deploy web-site --prod
```

`vercel.json` turns on clean URLs (so `/privacy` serves `privacy/index.html`),
sets `nosniff`, `DENY` framing, and a strict referrer policy, and caches
`/assets/*` for a week. There is no `/` redirect any more — the root is the
landing page.

Everything in this directory is served publicly. Nothing that is not meant to be
downloaded by a stranger belongs here; that is why the asset build script sits in
`../tools/` instead.

## After deploying

The privacy URL has to be pasted into three places, none of which pick it up
automatically:

1. Google Cloud Console → OAuth consent screen → **Privacy policy URL**. Google
   will not verify the app without it.
2. App Store Connect → app privacy.
3. Google Play Console → Store listing.

The landing page's download buttons point at the published Google Play listing:
`https://play.google.com/store/apps/details?id=com.notefusion.com`.

## Contact addresses

The policy cites `privacy@notefusion.studio` and `security@notefusion.studio`, and the
site footer cites `hello@notefusion.studio`. All three need to exist and be
monitored before the policy goes live — GDPR gives a 30-day response window, and
pointing at a dead mailbox is worse than pointing at a personal one.
