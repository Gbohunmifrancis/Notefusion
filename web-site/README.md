# NoteFusion public web

The marketing site and the privacy policy. No build step, no framework — plain
HTML, two CSS files, and one small script. Open `index.html` in a browser and you
are looking at production.

```
index.html            landing page
privacy/index.html    privacy policy (unchanged from when it was hosted alone)
terms/index.html      terms of service
robots.txt            declares sitemap.xml
sitemap.xml           the three public URLs
assets/theme.css      design tokens, copied from mobile/src/design/theme.ts
assets/landing.css    landing page layout
assets/landing.js     sticky-header border + reveal-on-scroll, nothing else
assets/mark.png       brand mark, white silhouette recoloured with a CSS mask
assets/app-home.jpg   hero screenshot          ┐ derived — see
assets/og-card.jpg    1200×630 social card     ┘   ../tools/build-assets.py
```

The two JPEGs are derived from `mobile/assets/` and should be rebuilt, not
hand-edited. The script lives at the repo root, outside the deploy root, so it
is never served over the network:

```bash
python tools/build-assets.py    # needs Pillow
```

It resizes the hero to 3× its display size (PNG → JPEG takes it from 1.1 MB to
134 KB, which matters on a Nigerian mobile connection) and draws the share card
in `gradients.brand` and Poppins, both read from the app's own artwork.

## The hero screenshot

⚠️ **`mobile/assets/Notefusion-home.png` is still the pre-launch design mockup,
not the shipped app.** It shows a *Transcribe* tab and a *Tools / Key Changer*
grid that were never built, an *Enable Sync* card that does not exist, recording
data dated May 2025, and it spells the name "Notefusion". The landing page
carries a `TODO(screenshot)` comment saying the same thing.

To replace it:

1. Take the shot on a real device (or an emulator at phone resolution) with the
   app signed in and a few saved transcriptions in the library, so the Home
   screen has real cards with real keys and BPM on them. Portrait, full screen,
   status bar included.
2. Save it over `mobile/assets/Notefusion-home.png`. That path is hard-coded as
   `SCREENSHOT` in `tools/build-assets.py`; keep the name and nothing else needs
   changing.
3. Rebuild:

   ```bash
   python tools/build-assets.py
   ```

   That regenerates `app-home.jpg` (828 w) and `app-home-552.jpg` (552 w) for the
   `srcset`, and prints the pixel dimensions of each.
4. If the new screenshot's aspect ratio differs from the old one, copy the 828 w
   dimensions the script printed into the hero `<img>`'s `width`/`height` in
   `index.html`. They are there to reserve layout space, so a stale `height`
   shows up as a jump while the page loads.
5. Delete the `TODO(screenshot)` comment, and check the `alt` text still
   describes what the image actually shows.

The other screens (Record, the solfa/staff result view, Library) are not used on
the site yet. If you want them in a gallery later, that is new markup and new
build-script output, not a swap.

Kept in `web-site/` rather than `docs/` deliberately: GitHub Pages' zero-config
option serves `docs/` wholesale, and that folder holds `NoteFusion_PRD.docx` and
`NoteFusion_TRD.docx` — publishing it would put the product requirements on the
open internet.

The admin dashboard is a separate application (`web-admin/`) with its own deploy.
This directory is public and unauthenticated; nothing here talks to the API.

## Design tokens

`assets/theme.css` is a hand-copy of `mobile/src/design/theme.ts`. Nothing keeps
them in sync, so **a palette change in the app has to be made here too**, or the
site and the product drift apart. The variable names mirror the TypeScript keys
to make that mechanical.

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

The landing page's download buttons point at
`https://play.google.com/store/apps/details?id=app.notefusion`, which 404s until
the listing is published.

## Contact addresses

The policy cites `privacy@notefusion.studio` and `security@notefusion.studio`, and the
site footer cites `hello@notefusion.studio`. All three need to exist and be
monitored before the policy goes live — GDPR gives a 30-day response window, and
pointing at a dead mailbox is worse than pointing at a personal one.
