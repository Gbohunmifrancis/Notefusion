// Site-wide constants for the generated blog and hymn pages. No dependencies: the deploy
// workflow's IndexNow step imports this file without installing anything.
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ORIGIN = "https://notefusion.studio";
export const SITE_NAME = "NoteFusion";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const CONTENT_DIR = path.join(REPO_ROOT, "content");
export const SITE_DIR = path.join(REPO_ROOT, "web-site");

/** Posts per page on /blog and /blog/page/N. */
export const PAGE_SIZE = 10;

/** Default social card; a post's own `cover` replaces it. 1200x630, built by tools/build-assets.py. */
export const DEFAULT_OG = { src: "/assets/og-card.jpg", width: 1200, height: 630, alt: "NoteFusion: audio to Tonic Solfa and staff notation" };

/**
 * IndexNow key. The same value is served at /<key>.txt (web-site/<key>.txt) so search engines can
 * check that a ping really comes from this site. It is not a secret: anyone can read it.
 */
export const INDEXNOW_KEY = "5a9e36b09808e88154439d37c4b945f1";

/**
 * Google AdSense auto ads, on the blog and hymn pages (and the policies); never the home page, the free tool pages
 * (`page({ ads: false })`) or the signed-in /app. Set to null to keep ads off the blog and hymn pages too.
 */
export const ADSENSE_CLIENT = "ca-pub-4167159170101513";

/** Pinned engraver for the staff on hymn pages: the same file and SRI hash /app and /app/sheet load. */
export const OSMD = {
  url: "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.1.2/build/opensheetmusicdisplay.min.js",
  sri: "sha384-12lItsNRZQLTAONzjzkiAB2oOKC7L9JPNqWBHro/ug0hLJZTmGxbr0V2JRt8KwC2",
};

/** Cache-busting versions for the hand-written assets the generated pages load (/assets is cached a week). */
export const ASSET_VERSION = { blogCss: 13, sitePagesCss: 7, hymnJs: 3, hymnsIndexJs: 6, choirJs: 7, track: 5, themeBoot: 2, siteTheme: 2, blogJs: 1, blogTrack: 1, recorderJs: 9, backJs: 1, recorderCss: 5, hymnIdentifyJs: 5, hymnIdentifyCss: 4, seasonJs: 4,
  // The home page's try box on the tool pages (lib/render-tools.mjs): the same files at the same versions as web-site/index.html loads.
  homeCss: 7, previewJs: 15, songlinkJs: 3, rangepickerJs: 1, rangepickerCss: 4, meterJs: 1, toolsCss: 1 };

/** The call to action every post and hymn page ends with. */
export const APP_URL = "/app";
