# NoteFusion public web

Static pages served outside the app. Currently just the privacy policy, which the
Google OAuth consent screen and both app-store listings have to link to.

Kept in `web/` rather than `docs/` deliberately: GitHub Pages' zero-config option
serves `docs/` wholesale, and that folder holds `NoteFusion_PRD.docx` and
`NoteFusion_TRD.docx` — publishing it would put the product requirements on the
open internet.

## Deploying

**Vercel** — point a project at this directory. `vercel.json` handles clean URLs
and redirects `/` to `/privacy`.

```bash
npx vercel deploy web --prod
```

**GitHub Pages** — Settings → Pages → deploy from a branch, folder `/web`.
`.nojekyll` stops Jekyll from swallowing files, and `index.html` redirects to the
policy.

## After deploying

The URL has to be pasted into three places, none of which pick it up automatically:

1. Google Cloud Console → OAuth consent screen → **Privacy policy URL**. Google
   will not verify the app without it.
2. App Store Connect → app privacy.
3. Google Play Console → Store listing.

## Contact addresses

The page cites `privacy@notefusion.app` and `security@notefusion.app`. Both need to
exist and be monitored before the policy goes live — GDPR gives a 30-day response
window, and pointing at a dead mailbox is worse than pointing at a personal one.
