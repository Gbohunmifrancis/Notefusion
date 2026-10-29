"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The page every id shares in the static console (Cloudflare serves `/users/{id}` from `/users/_`, see
 * `public/_redirects`): never an id of its own.
 */
export const PATH_ID_PLACEHOLDER = "_";

/**
 * The id in the address bar after `prefix` (`/users/` → the account's id). The console is static files, so one page
 * stands for every id and the id is read from the address, once the page is in the browser (null before then, and
 * for the placeholder itself). Follows client-side navigation between ids.
 */
export function usePathId(prefix: string): string | null {
  const pathname = usePathname();
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    setPath(window.location.pathname);
  }, [pathname]);
  if (!path || !path.startsWith(prefix)) return null;
  const segment = path.slice(prefix.length).split("/")[0] ?? "";
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return id && id !== PATH_ID_PLACEHOLDER ? id : null;
}
