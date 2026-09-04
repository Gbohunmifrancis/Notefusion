# NoteFusion public web

The marketing site and the privacy policy. No build step, no framework — plain
HTML, two CSS files, and two small scripts. Open `index.html` in a browser and you
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
assets/pricing.js     location-aware pricing from /api/billing/public-plans
assets/mark.png       brand mark, white silhouette recoloured with a CSS mask
assets/app-onboarding.jpg  hero, front device   ┐ derived — see
assets/app-splash.jpg      hero, back device    │   ../tools/build-assets.py
assets/og-card.jpg         1200×630 social card ┘   (plus a -552.jpg each)
```

The hero JPEGs are derived from `mobile/assets/` and should be rebuilt, not
hand-edited. The script lives at the repo root, outside the deploy root, so it
is never served over the network:

```bash
python tools/build-assets.py    # needs Pillow
```

It resizes each hero screen to 3× its display width (PNG → JPEG takes 1.1 MB to
~120 KB, which matters on a Nigerian mobile connection) and draws the share card
in `gradients.brand` and Poppins, both read from the app's own artwork.

## The hero devices

The hero is two app screens angled in one shared 3D space, store-listing style,
not a flat screenshot:

| Layer | Source in `mobile/assets/` | Output |
|---|---|---|
| front | `Notefusion-onboarding-1.png` | `app-onboarding.jpg` + `-552` |
| back | `Notefusion-splash-screen.png` | `app-splash.jpg` + `-552` |

Both sources have **the black device frame rendered into them**, which is why
`.device` adds no bezel of its own — it only rounds the corners the render
leaves square and supplies the perspective, shadow and glare. Feed it a bare
screen capture (as `Notefusion-home.png` was) and the hero will look frameless;
you would need to put the old `padding` + dark `background` back on `.device` to
compensate.

The angle, the shadows and the sheen are all CSS — `perspective` on `.showcase`,
`rotateY`/`rotateX` per device. Nothing is baked into the JPEGs, so the tilt is
editable in `landing.css` without touching an image.

To swap a screen:

1. Capture portrait, full screen, status bar included, at phone resolution —
   with the device frame if you want the current look.
2. Save it over the matching file in `mobile/assets/`, or point `HERO_SCREENS`
   in `tools/build-assets.py` at a new name.
3. Rebuild:

   ```bash
   python tools/build-assets.py
   ```

   It prints the exact pixel dimensions of all four outputs.
4. Copy the 828 w dimensions it printed into that `<img>`'s `width`/`height` in
   `index.html`. They reserve the layout box, so a stale `height` shows up as a
   jump while the page loads. If the aspect ratio changed, also update the
   `2.162` multiplier in `.showcase`'s `height`.
5. Check the `alt` text still describes what the image actually shows.

The remaining screens (Record, the solfa/staff result view, Library) are not on
the site yet. A third device, or a scrolling gallery, is new markup — not a swap.

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

The landing page's download buttons point at the published Google Play listing:
`https://play.google.com/store/apps/details?id=com.notefusion.com`.

## Contact addresses

The policy cites `privacy@notefusion.studio` and `security@notefusion.studio`, and the
site footer cites `hello@notefusion.studio`. All three need to exist and be
monitored before the policy goes live — GDPR gives a 30-day response window, and
pointing at a dead mailbox is worse than pointing at a personal one.
