import React from "react";
import { PendingSends } from "./PendingSends";
import { showDialog } from "../../lib/dialog";
import { openTranscriptionFromNotification } from "../../lib/notificationLink";
import { removeTake, retryTake } from "../../lib/outbox";
import type { QueuedSend } from "../../lib/sendQueue";
import type { useSongOnItsWay } from "../../lib/useSongOnItsWay";

/**
 * "On its way" with what each row does: open a take whose sheet is written, try one again, delete one. The Library
 * lists it above the sheets and Home above Recent, so a take sent while the app was closed (Listen from anywhere,
 * a recording that waited for a connection) is in sight on the screen the app opens on, still being written.
 */
export function OnItsWay({
  items,
  progress,
  song,
}: {
  items: readonly QueuedSend[];
  progress: ReadonlyMap<string, number>;
  song: ReturnType<typeof useSongOnItsWay>;
}) {
  return (
    <PendingSends
      items={items}
      progress={progress}
      song={song.row}
      onOpenSong={() => {
        const jobId = song.jobId;
        if (!jobId) return;
        void openTranscriptionFromNotification(jobId).then((opened) => opened && song.forget());
      }}
      onDismissSong={song.forget}
      onRetry={(t) => retryTake(t.id)}
      onOpen={(t) => {
        if (!t.jobId) return;
        void openTranscriptionFromNotification(t.jobId).then((opened) => opened && removeTake(t.id));
      }}
      onDelete={(t) =>
        t.status === "done"
          ? removeTake(t.id)
          : showDialog({
              title: "Delete this recording?",
              message: "It hasn't been sent, so nothing is used up — but the audio is gone for good.",
              icon: "delete",
              tone: "danger",
              actions: [
                { label: "Delete", style: "destructive", onPress: () => removeTake(t.id) },
                { label: "Keep it", style: "cancel" },
              ],
            })
      }
    />
  );
}
