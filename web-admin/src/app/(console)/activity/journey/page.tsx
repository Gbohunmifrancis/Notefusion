import { Suspense } from "react";

import { JourneyView } from "./JourneyView";

export default function JourneyPage() {
  return (
    <Suspense>
      <JourneyView />
    </Suspense>
  );
}
