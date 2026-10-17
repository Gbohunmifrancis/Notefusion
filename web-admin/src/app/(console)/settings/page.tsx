import type { Metadata } from "next";

import { SettingsView } from "./SettingsView";

export const metadata: Metadata = { title: "Settings · NoteFusion Admin" };

export default function SettingsPage() {
  return <SettingsView />;
}
