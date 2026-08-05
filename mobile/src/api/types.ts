/** Types mirroring the C# Web API's JSON wire contract (src/NoteFusion.* DTOs). */

// --- Auth ---------------------------------------------------------------

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface MyProfile {
  id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt: string;
}

// --- Transcriptions -----------------------------------------------------

export type TranscriptionStatus = "pending" | "processing" | "done" | "failed";

export interface NoteEvent {
  pitchMidi: number;
  startBeat: number;
  durBeats: number;
  degree: number;
  solfa: string;
  octaveMark: string;
  conf: number;
}

export interface TranscriptionResult {
  key: string;
  keyConfidence: number;
  tempo: number;
  timeSignature: string;
  musicXml: string;
  midiBase64: string;
  notes: NoteEvent[];
  solfaLines: string[];
  overallConfidence: number;
  /**
   * Base64-encoded 16-bit PCM WAV audio preview synthesised server-side from
   * the note list (numpy + soundfile — no system audio libraries required).
   * Empty string when synthesis produced no output.
   * Written to a cache file with expo-file-system and played via expo-av.
   */
  audioPreviewBase64?: string;
}

export interface TranscriptionJob {
  jobId: string;
  status: TranscriptionStatus;
  progress: number;
  result?: TranscriptionResult | null;
  /**
   * Human-readable failure reason from the Python worker
   * (e.g. "No confident notes detected in the recording").
   * Non-null only when status === 'failed'.
   * Previously this field was absent from the C# DTO so Python error
   * messages were silently dropped and the mobile showed a hardcoded string.
   */
  error?: string | null;
}

// --- Library ------------------------------------------------------------

export interface SavedTranscription {
  id: string;
  title: string;
  key: string;
  tempoBpm: number;
  timeSignature: string;
  overallConfidence: number;
  createdAtUtc: string;
  notes?: NoteEvent[] | null;
}

// --- API errors ---------------------------------------------------------

/** The ApiError envelope every 4xx/5xx carries (ApiError code/message/details). */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}
