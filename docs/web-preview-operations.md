# Web preview operations

## Enablement

The preview is **disabled by default**. Enable it only after applying the EF migration and verifying that the deployed API can reach the Python worker:

```bash
heroku config:set \
  WebPreview__Enabled=true \
  WebPreview__MaxUploadBytes=10485760 \
  WebPreview__MaxClipSeconds=30 \
  WebPreview__DailyAllowance=1 \
  WebPreview__RetentionHours=24 \
  -a notefusion-api
```

The public static site currently uses the production API URL in `web-site/assets/landing.js`. If the API hostname changes, update that value through the site's normal deployment configuration before enabling the CTA.

## Admin reporting

The aggregate report is available to an authenticated administrator at:

```text
GET /api/admin/analytics/web-funnel?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z
```

It returns preview jobs, completed previews, failed previews, expired previews, and event counts. It does not return anonymous IDs, raw audio, preview tokens, or event metadata. The endpoint is intended to be connected to a dashboard card after the first live cohort has enough volume to make the metrics meaningful.

## Recommended launch checks

Before enabling production traffic:

1. Apply `20260920020000_AddWebPreviewAndProductEvents` and confirm both tables and indexes exist.
2. Add the public website origin to the API CORS allow-list if the site is not served from `https://notefusion.studio`.
3. Open the landing page from a clean browser profile and verify `landing_view`, `upload_started`, `job_created`, `preview_ready`, and `mobile_opened` event behavior in the admin report.
4. Test a valid short WAV, an upload over 10 MiB, an audio clip over 30 seconds, a second attempt from the same browser identity, an invalid preview token, and a worker failure.
5. Confirm no request from the browser targets the Python worker URL.
6. Measure p50/p95 submit-to-ready latency, completion rate, quota-hit rate, preview-ready-to-mobile-click rate, and preview-to-account conversion.

## Local validation

The sandbox used for this branch does not contain the .NET SDK, so C# build/test validation remains a local or CI gate. Run:

```bash
dotnet build NoteFusion.slnx -c Release
dotnet test NoteFusion.slnx
cd server && python -m pytest -q
node --check web-site/assets/landing.js
```

Do not turn the feature on in production until the .NET build, migration application, and API-to-Python integration test pass.
