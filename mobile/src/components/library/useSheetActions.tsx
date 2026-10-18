/**
 * The saved-sheet actions a list offers, for the Library (its selection bar) and Home's recent rows (board a-core/11):
 * share links, share with the choir, file in a folder (or a new one), rename, keep offline, delete. One
 * implementation on `lib/sheetActions`, so both lists act and read the same; each keeps its own list, which this
 * updates in place. `element` holds the sheets these open (the one sheet's actions, New folder, Rename): render it
 * once in the screen.
 */

import React, { useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Button } from "../Button";
import { Sheet, SheetActions, SheetTitle } from "../Sheet";
import { TextField } from "../TextField";
import { SheetActionsSheet } from "./SheetActionsSheet";
import { showDialog } from "../../lib/dialog";
import { useSubscription } from "../../lib/subscription";
import { useOfflineLibrary } from "../../lib/offlineLibrary";
import {
  askToDelete,
  deleteSheets,
  fileSheets,
  keepSheetOffline,
  renameSheet,
  setChoirSharing,
  shareSheetLinks,
} from "../../lib/sheetActions";
import { spacing } from "../../design/theme";
import type { SavedTranscription } from "../../api/types";

type SetItems = React.Dispatch<React.SetStateAction<SavedTranscription[]>>;

interface Options {
  /** The list acted on (its folders are the ones offered). */
  items: readonly SavedTranscription[];
  setItems: SetItems;
  /** Read the list again: after a delete the server refused. */
  reload: () => void;
  /** An action on the chosen sheets went through (the Library leaves select mode). */
  onDone?: () => void;
  /** How deleted sheets leave the list; at once by default. Home folds the row away first. */
  onDeleted?: (ids: ReadonlySet<string>) => void;
}

export function useSheetActions({ items, setItems, reload, onDone, onDeleted }: Options) {
  const { subscription } = useSubscription();
  // The choir this account is in while its plan runs: sheets can be shared with it.
  const choirName = subscription?.choirName ?? null;
  const offline = useOfflineLibrary();

  const [sharing, setSharing] = useState(false);
  const [naming, setNaming] = useState<SavedTranscription[] | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [renaming, setRenaming] = useState<SavedTranscription | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [actionsFor, setActionsFor] = useState<SavedTranscription | null>(null);
  const lastActions = useRef<SavedTranscription | null>(null);
  if (actionsFor) lastActions.current = actionsFor;
  /** What a row of the actions sheet asked for: run once the sheet has gone (iOS shows one modal at a time). */
  const afterClose = useRef<(() => void) | null>(null);

  const folders = useMemo(
    () => [...new Set(items.map((i) => i.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const patch = (ids: ReadonlySet<string>, change: (t: SavedTranscription) => SavedTranscription) =>
    setItems((prev) => prev.map((t) => (ids.has(t.id) ? change(t) : t)));

  async function shareLinks(targets: SavedTranscription[]) {
    if (targets.length === 0) return;
    setSharing(true);
    const tokens = await shareSheetLinks(targets);
    setSharing(false);
    if (!tokens) return;
    patch(new Set(tokens.keys()), (t) => ({ ...t, shareToken: tokens.get(t.id) }));
    onDone?.();
  }

  async function shareWithChoir(targets: SavedTranscription[], share: boolean) {
    const done = await setChoirSharing(targets, share);
    patch(done, (t) => ({ ...t, sharedWithChoir: share }));
    onDone?.();
  }

  /** In a choir, sharing asks where: the choir's library, or public links. */
  function chooseShare(targets: SavedTranscription[]) {
    if (targets.length === 0) return;
    if (!choirName) {
      void shareLinks(targets);
      return;
    }
    const allShared = targets.every((t) => t.sharedWithChoir);
    showDialog({
      kind: "options",
      title: targets.length === 1 ? targets[0]!.title : `${targets.length} sheets`,
      message: "Share",
      actions: [
        allShared
          ? { label: "Take out of choir library", icon: "choir", onPress: () => void shareWithChoir(targets, false) }
          : { label: `Share with ${choirName}`, icon: "choir", onPress: () => void shareWithChoir(targets, true) },
        { label: "Send links", icon: "link", onPress: () => void shareLinks(targets) },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  async function fileIn(targets: SavedTranscription[], name: string | null) {
    const { moved, ok } = await fileSheets(targets, name);
    patch(moved, (t) => ({ ...t, folder: name }));
    if (ok) onDone?.();
  }

  function chooseFolder(targets: SavedTranscription[]) {
    if (targets.length === 0) return;
    const one = targets.length === 1 ? targets[0]! : null;
    showDialog({
      kind: "options",
      title: one ? one.title : `${targets.length} sheets`,
      message: "Move to a folder",
      actions: [
        ...folders.slice(0, 6).map((f) => ({
          label: f,
          icon: "folder" as const,
          selected: targets.every((t) => t.folder === f),
          onPress: () => void fileIn(targets, f),
        })),
        {
          label: "New folder…",
          icon: "add",
          onPress: () => {
            setNewFolder("");
            setNaming(targets);
          },
        },
        ...(targets.some((t) => t.folder)
          ? [{ label: "Take out of folder", icon: "folder-out" as const, onPress: () => void fileIn(targets, null) }]
          : []),
        { label: "Cancel", style: "cancel" as const },
      ],
    });
  }

  function confirmDelete(targets: SavedTranscription[]) {
    askToDelete(targets, async () => {
      const ids = new Set(targets.map((t) => t.id));
      if (onDeleted) onDeleted(ids);
      else setItems((prev) => prev.filter((t) => !ids.has(t.id)));
      onDone?.();
      if (!(await deleteSheets(targets))) reload();
    });
  }

  async function rename(target: SavedTranscription, title: string) {
    const kept = await renameSheet(target.id, title);
    if (kept !== null) patch(new Set([target.id]), (t) => ({ ...t, title: kept }));
  }

  /** Opens one sheet's actions (Home's ⋯ and long press). */
  function openActions(item: SavedTranscription) {
    setActionsFor(item);
  }

  function closeActions(then?: () => void) {
    afterClose.current = then ?? null;
    setActionsFor(null);
  }

  const one = actionsFor ?? lastActions.current;
  const handlers = {
    onShareLink: () => one && closeActions(() => void shareLinks([one])),
    onChoir: () => one && closeActions(() => void shareWithChoir([one], !one.sharedWithChoir)),
    onRename: () =>
      one &&
      closeActions(() => {
        setNewTitle(one.title);
        setRenaming(one);
      }),
    onMove: () => one && closeActions(() => chooseFolder([one])),
    onKeepOffline: (keep: boolean) => {
      if (one) void keepSheetOffline(one.id, keep);
    },
    onDelete: () => one && closeActions(() => confirmDelete([one])),
  };

  const element = (
    <>
      <SheetActionsSheet
        sheet={actionsFor}
        onClose={() => closeActions()}
        onClosed={() => {
          const run = afterClose.current;
          afterClose.current = null;
          run?.();
        }}
        choirName={choirName}
        kept={!!one && offline.pinned.has(one.id)}
        keepAll={offline.keepAll}
        handlers={handlers}
      />
      {/* One field, then [Cancel] [Create]: the new folder is made by filing the sheets in it. */}
      <Sheet visible={naming !== null} onClose={() => setNaming(null)} avoidKeyboard>
        <SheetTitle>New folder</SheetTitle>
        <TextField
          label="Folder name"
          placeholder="Sunday choir, Easter service…"
          value={newFolder}
          onChangeText={setNewFolder}
          autoFocus
          maxLength={80}
        />
        <SheetActions style={styles.actions}>
          <Button label="Cancel" variant="text" onPress={() => setNaming(null)} />
          <Button
            label="Create"
            disabled={newFolder.trim().length === 0}
            onPress={() => {
              const targets = naming;
              setNaming(null);
              if (targets) void fileIn(targets, newFolder.trim());
            }}
          />
        </SheetActions>
      </Sheet>
      {/* Rename: one field, then [Cancel] [Save]. */}
      <Sheet visible={renaming !== null} onClose={() => setRenaming(null)} avoidKeyboard>
        <SheetTitle>Rename</SheetTitle>
        <TextField label="Name" value={newTitle} onChangeText={setNewTitle} autoFocus maxLength={200} />
        <SheetActions style={styles.actions}>
          <Button label="Cancel" variant="text" onPress={() => setRenaming(null)} />
          <Button
            label="Save"
            disabled={newTitle.trim().length === 0 || newTitle.trim() === renaming?.title}
            onPress={() => {
              const target = renaming;
              setRenaming(null);
              if (target) void rename(target, newTitle);
            }}
          />
        </SheetActions>
      </Sheet>
    </>
  );

  return { folders, choirName, sharing, actionsFor, openActions, chooseShare, chooseFolder, confirmDelete, element };
}

const styles = StyleSheet.create({
  actions: {
    marginTop: spacing.lg,
  },
});
