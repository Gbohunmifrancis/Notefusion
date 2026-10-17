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
 * Google AdSense auto ads, on the public pages only (the same client id as the home page and the
 * policies). Set to null to keep ads off the blog and hymn pages.
 */
export const ADSENSE_CLIENT = "ca-pub-4167159170101513";

/** Pinned engraver for the staff on hymn pages: the same file and SRI hash /app and /app/sheet load. */
export const OSMD = {
  url: "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.1.2/build/opensheetmusicdisplay.min.js",
  sri: "sha384-12lItsNRZQLTAONzjzkiAB2oOKC7L9JPNqWBHro/ug0hLJZTmGxbr0V2JRt8KwC2",
};

/** Cache-busting versions for the hand-written assets the generated pages load (/assets is cached a week). */
export const ASSET_VERSION = { blogCss: 6, sitePagesCss: 4, hymnJs: 2, hymnsIndexJs: 2, choirJs: 3, track: 5, themeBoot: 2, siteTheme: 1, blogJs: 1, blogTrack: 1, recorderJs: 3, recorderCss: 3, hymnIdentifyJs: 1, hymnIdentifyCss: 2 };

/** The call to action every post and hymn page ends with. */
export const APP_URL = "/app";
