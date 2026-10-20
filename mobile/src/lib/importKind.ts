import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether audio from outside the app — an imported file, a recording of a speaker — is a song with
 * instruments (lead vocal isolated first, costs a song credit on Pro) or a tune someone hummed.
 * Defaults to the song: a file from the phone's library almost always is one, and the mixture
 * transcribed whole comes back as a scatter of wrong notes. The last answer is remembered.
 */

export type ImportKind = 'song' | 'voice';

const KEY = 'nf.importKind';

let current: ImportKind = 'song';
/** Whether anyone has answered on this phone yet: until then nothing is "last time". */
let answered = false;

export function loadImportKind(): Promise<void> {
  return AsyncStorage.getItem(KEY)
    .then((stored) => {
      if (stored === 'song' || stored === 'voice') {
        current = stored;
        answered = true;
      }
    })
    .catch(() => undefined);
}

export function importKind(): ImportKind {
  return current;
}

export function importKindAnswered(): boolean {
  return answered;
}

export async function setImportKind(kind: ImportKind): Promise<void> {
  current = kind;
  answered = true;
  await AsyncStorage.setItem(KEY, kind).catch(() => undefined);
}
