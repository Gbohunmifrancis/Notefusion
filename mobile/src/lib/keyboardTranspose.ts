import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The transpose setting on the player's keyboard, in semitones (−11…11), sent with every submit as
 * `keyboardTranspose` so a sheet reads as the music sounded rather than as the shapes were played
 * (−4 when A shapes sound F). Kept in AsyncStorage and cached in a module variable, like haptics:
 * the record screen reads it on every submit and must never wait for storage.
 */

const KEY = 'nf.keyboardTranspose';

let current = 0;

/** All the values the picker offers: 0 first, then −1…−11, then +1…+11. */
export const KEYBOARD_TRANSPOSE_CHOICES: readonly number[] = [
  0,
  ...Array.from({ length: 11 }, (_, i) => -(i + 1)),
  ...Array.from({ length: 11 }, (_, i) => i + 1),
];

export function loadKeyboardTranspose(): Promise<void> {
  return AsyncStorage.getItem(KEY)
    .then((stored) => {
      const n = Number(stored);
      if (stored !== null && Number.isInteger(n) && n >= -11 && n <= 11) current = n;
    })
    .catch(() => undefined);
}

export function keyboardTranspose(): number {
  return current;
}

export async function setKeyboardTranspose(semitones: number): Promise<void> {
  current = semitones;
  await AsyncStorage.setItem(KEY, String(semitones)).catch(() => undefined);
}

/** "0", "−4", "+5" — the label on a chip. */
export function keyboardTransposeLabel(semitones: number): string {
  return semitones === 0 ? '0' : semitones < 0 ? `−${-semitones}` : `+${semitones}`;
}
