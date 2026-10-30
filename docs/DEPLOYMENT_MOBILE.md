# Releasing the mobile app

Builds run on EAS, not locally — `mobile/eas.json` holds the profiles. Two artifacts matter:

| Profile | Artifact | What it is for |
|---|---|---|
| `production` | `.apk` | Sideloading a real release build onto a device, over `adb` or a download link. Not accepted by Play. |
| `store` | `.aab` | The Play Store upload. |

```bash
cd mobile
npx eas-cli@latest build -p android --profile production   # installable APK
npx eas-cli@latest build -p android --profile store        # Play AAB
```

Both set `autoIncrement: true`, and `cli.appVersionSource` is `remote`, so EAS owns the
`versionCode` counter and bumps it per build. Play rejects an upload whose `versionCode` is not
higher than one it has already seen, so never hand-edit it.

> The `development` profile builds a dev client, which needs a Metro server running to boot. It
> is for exercising native modules, not for handing someone something to test.

## Publishing to Play automatically

`--auto-submit` uploads the build the moment it finishes:

```bash
npx eas-cli@latest build -p android --profile store --auto-submit
```

An existing build can be submitted without rebuilding:

```bash
npx eas-cli@latest submit -p android --profile production --latest
```

`submit.production` in `eas.json` targets the **`internal`** track, which lands the release in
Play Console for internal testers. It does not reach the public. Changing `track` to
`production` makes every submission a public release — a rollout can be halted but not unsent,
so treat that edit as the release decision it is.

### The two prerequisites, in order

Both live in Google Cloud / Play Console and neither can be scripted from this repo. Do them in
the project that also owns the Google sign-in OAuth clients — `notefusion-505016`, project number
**21738378819**, which is why the client ids in `mobile/app.json` are prefixed with it. Keeping
the publishing identity and the auth clients in one project is what avoids the wrong-project trap
described in [DEPLOYMENT.md §2](DEPLOYMENT.md).

1. **Enable the Google Play Android Developer API** in that project:
   <https://console.developers.google.com/apis/api/androidpublisher.googleapis.com/overview?project=21738378819>

   Skipping this fails with `403 … has not been used in project 21738378819 before or it is
   disabled` — raised by the Play API, not by EAS, so the message never mentions your build.

2. **Grant the service account access** in Play Console → Users and permissions → invite
   `notefusion@notefusion-505016.iam.gserviceaccount.com` with **Release manager** (or narrower:
   release to testing tracks only). Enabling the API alone is not enough; the account also has
   to be a user of the Play developer account.

> A service account is scoped to one GCP project, and its key stops working the moment the
> account is deleted — the token endpoint then answers `invalid_grant: account not found`, which
> reads like a malformed key rather than a missing identity. If you move the account between
> projects, generate a fresh key and replace the file below; the old one cannot be revived.


### The service account key

`eas submit` authenticates with `mobile/google-play-service-account.json`, pointed at by
`submit.production.android.serviceAccountKeyPath`.

**It is gitignored and must stay that way.** It is a private RSA key that can publish to your
store listing, and Google offers no read-only variant — anyone holding it can ship to your
users. Keep it out of Downloads and shared folders too, not just out of git. If it leaks,
delete the key in the Cloud Console (IAM → Service accounts → Keys) and generate a new one;
the account itself and its Play permission survive, so only the path above needs updating.

### Submitting from GitHub

`.github/workflows/android-submit.yml` (Actions › Android submit › Run workflow, with the run id of an "Android build"
run made with the profile `production`) downloads that run's `.aab` and sends it with `eas submit` exactly as above: the
internal track, the release completed. It writes the key from the repository secret `GOOGLE_PLAY_SUBMIT_KEY` (this
file's JSON; else the API's `GOOGLEPLAY__SERVICEACCOUNTJSON`, if that account may release) for that one step only.

### Verifying the pipeline without a build

The whole chain — key valid, API enabled, Play permission granted — can be checked in seconds
by creating a throwaway edit and deleting it. Worth doing before a 20-minute build:

```bash
cd mobile && node -e "
const crypto=require('crypto'), k=require('./google-play-service-account.json');
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
(async()=>{
  const now=Math.floor(Date.now()/1000);
  const jwt=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:k.client_email,
    scope:'https://www.googleapis.com/auth/androidpublisher',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const sig=crypto.createSign('RSA-SHA256').update(jwt).sign(k.private_key).toString('base64url');
  const t=await (await fetch('https://oauth2.googleapis.com/token',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:jwt+'.'+sig})})).json();
  if(!t.access_token) return console.log('token failed:', t.error_description||t.error);
  const r=await fetch('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.notefusion.com/edits',
    {method:'POST',headers:{Authorization:'Bearer '+t.access_token,'Content-Type':'application/json'},body:'{}'});
  const j=await r.json();
  if(!r.ok) return console.log('play api:', r.status, j.error&&j.error.message);
  console.log('OK — can publish');
  await fetch('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.notefusion.com/edits/'+j.id,
    {method:'DELETE',headers:{Authorization:'Bearer '+t.access_token}});
})();
"
```

## Signing, and why Google sign-in depends on it

EAS signs with the keystore stored on its own servers. `mobile/credentials.json` exists but
`credentialsSource` is unset in `eas.json`, which defaults to **remote** — so that file is
currently ignored, and editing it changes nothing about a build. (Both keystores happen to hold
the same key, so this is harmless today; it is a trap only if they ever diverge.)

To read the fingerprint of a built artifact directly:

```bash
JAVA_HOME='/c/Program Files/Android/Android Studio/jbr' \
  "$LOCALAPPDATA/Android/Sdk/build-tools/37.0.0/apksigner.bat" verify --print-certs app.apk
```

Because the app uses Play App Signing, a sideloaded APK and a Play install present **different**
certificates, and Google sign-in matches on them — see the fingerprint table in
[DEPLOYMENT.md §2](DEPLOYMENT.md). Both must be registered on the Android OAuth client.
