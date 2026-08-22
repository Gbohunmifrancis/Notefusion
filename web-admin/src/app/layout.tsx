import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";

import { Providers } from "@/app/providers";
import "@/app/globals.css";

/**
 * Poppins, the app's typeface (see mobile/src/design/theme.ts `fonts`). Weights are limited to
 * the four the design system actually names. `next/font` self-hosts the files at build time and
 * exposes them as `--font-poppins`, which `globals.css` reads as `--font-sans` — so there is no
 * runtime request to fonts.googleapis.com and no flash of a fallback face.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NoteFusion Admin",
  description: "Operations console for NoteFusion.",
  // Internal tool: keep it out of search results entirely. vercel.json sends the matching
  // X-Robots-Tag header, because a meta tag only helps for crawlers that render the page.
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /*
   * Tells the browser which chrome to draw — form controls, scrollbars, the address bar on
   * mobile — for each mode. The old runtime set `documentElement.style.colorScheme` by hand;
   * next-themes does it now, and declaring both here means the very first paint (before any
   * script has run) already has the right one rather than a light scrollbar on a dark page.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes: its inline script sets `class` and
    // `style` on this element before React hydrates, so the attributes will not match the
    // server HTML. It suppresses the warning for this one element only, not the tree.
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
