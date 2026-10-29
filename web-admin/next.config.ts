import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * Deliberately almost empty.
 *
 * No `images.remotePatterns`: avatars are arbitrary URLs (Google's CDN, our R2 bucket), and
 * allow-listing hosts for user-supplied images would fail closed on the next storage change.
 * `Avatar` renders a plain `<img>` with its own error fallback instead, which is also what
 * shadcn's `AvatarImage` does.
 *
 * `output: "export"`: the console is static files on Cloudflare (Workers static assets; wrangler.jsonc). It is all
 * client components talking to the API with the operator's token, so nothing needs a server. The pages with an id
 * in the path (/users/[id], /blog/[id], /sessions/[id], /payments/[id]) are built once for a placeholder id and
 * served for every id by `public/_redirects`; they read the id from the address (`usePathId`).
 */
const nextConfig: NextConfig = {
  output: "export",
  // The console is admin-only and noindex; nothing here should be crawled or previewed.
  poweredByHeader: false,
};

/**
 * `NEXT_PUBLIC_API_URL` is inlined into the client bundle at build time, so a deploy that
 * forgot it cannot be fixed by setting the variable afterwards — the shipped JavaScript
 * already has an empty string baked in, every request goes to a relative path on the console's own host,
 * and the console renders a fully styled shell that can load nothing. Failing the build is
 * the only place that mistake is still cheap.
 *
 * Gated to the production build so `next dev` still starts for someone who has not written
 * `.env.local` yet; there, `src/api/client.ts` surfaces the misconfiguration as failed
 * requests you can read in the network tab.
 */
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.NEXT_PUBLIC_API_URL) {
    throw new Error(
      "NEXT_PUBLIC_API_URL is not set. The dashboard talks to the NoteFusion API over " +
        "HTTP and has no same-origin fallback — set it in .env.production " +
        "(committed) to the API's origin, e.g. https://api.notefusion.studio",
    );
  }

  return nextConfig;
}
