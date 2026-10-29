"use client";

import { usePathId } from "@/hooks/usePathId";

import { SessionPlayerView } from "./SessionPlayerView";

/** The recording's Sentry id is in the path: read from the address and handed to the view as a plain string. */
export default function SessionPlayerPage() {
  const id = usePathId("/sessions/");
  return id ? <SessionPlayerView id={id} /> : null;
}
