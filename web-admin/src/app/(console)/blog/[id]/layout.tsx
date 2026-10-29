import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Blog post · NoteFusion Admin" };

/**
 * The console is static files on Cloudflare: one page, built for the placeholder id, serves every
 * `/blog/{id}` (`public/_redirects`), and the page reads the real id from the address.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  // "_": usePathId's PATH_ID_PLACEHOLDER (a client module, so not imported here).
  return [{ id: "_" }];
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
