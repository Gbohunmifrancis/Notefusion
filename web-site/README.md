# NoteFusion public web

The marketing site and the privacy policy. No build step, no framework — plain
HTML, two CSS files, and one small script. Open `index.html` in a browser and you
are looking at production.

```
index.html            landing page
privacy/index.html    privacy policy (unchanged from when it was hosted alone)
assets/theme.css      design tokens, copied from mobile/src/design/theme.ts
assets/landing.css    landing page layout
assets/landing.js     sticky-header border + reveal-on-scroll, nothing else
assets/mark.png       brand mark, white silhouette recoloured with a CSS mask
assets/app-home.jpg   hero screenshot          ┐ derived — see build-assets.py
assets/og-card.jpg    1200×630 social card     ┘
assets/build-assets.py  regenerates both of the above
```

The two JPEGs are derived from `mobile/assets/` and should be rebuilt, not
hand-edited:

```bash
python assets/build-assets.py    # needs Pillow
```

It resizes the hero to 3× its display size (PNG → JPEG takes it from 1.1 MB to
134 KB, which matters on a Nigerian mobile connection) and draws the share card
in `gradients.brand` and Poppins, both read from the app's own artwork.

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

**GitHub Pages** — Settings → Pages → deploy from a branch, folder `/web-site`.
`.nojekyll` stops Jekyll from swallowing files. Pages ignores `vercel.json`, so
clean URLs and the headers do not apply there.

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

The policy cites `privacy@notefusion.app` and `security@notefusion.app`, and the
site footer cites `hello@notefusion.app`. All three need to exist and be
monitored before the policy goes live — GDPR gives a 30-day response window, and
pointing at a dead mailbox is worse than pointing at a personal one.
