import type { Metadata } from "next";

import { FlagsView } from "./FlagsView";

export const metadata: Metadata = { title: "Feature flags · NoteFusion Admin" };

export default function FlagsPage() {
  return <FlagsView />;
}
