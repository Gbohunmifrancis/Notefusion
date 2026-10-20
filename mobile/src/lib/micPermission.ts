/**
 * The microphone refused (board l-ux-high 02a). While the phone can still ask, tapping Record or Sing it asks
 * again; once Android or iOS will no longer ask (`canAskAgain` false), only the phone's settings can turn the
 * microphone on, so the note gets an "Open settings" button.
 */
export function onlySettingsCanGrant(perm: { granted: boolean; canAskAgain: boolean }): boolean {
  return !perm.granted && !perm.canAskAgain;
}
