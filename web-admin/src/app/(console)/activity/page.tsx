import { Suspense } from "react";

import { ActivityView } from "./ActivityView";

export default function ActivityPage() {
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  );
}
