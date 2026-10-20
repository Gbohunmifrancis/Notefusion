import type { Metadata } from "next";

import { SessionPlayerView } from "./SessionPlayerView";

export const metadata: Metadata = { title: "Recording · NoteFusion Admin" };

/** The recording's Sentry id is in the path, so this shell awaits it and hands the view a plain string. */
export default async function SessionPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionPlayerView id={id} />;
}
