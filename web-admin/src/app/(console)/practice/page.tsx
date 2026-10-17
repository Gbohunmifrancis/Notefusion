import type { Metadata } from "next";

import { PracticeView } from "./PracticeView";

export const metadata: Metadata = { title: "Practice · NoteFusion Admin" };

export default function PracticePage() {
  return <PracticeView />;
}
