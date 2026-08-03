import { api } from './client';
import type {
  LoginResponse,
  MyProfile,
  SavedTranscription,
  TranscriptionJob,
} from './types';

/** Typed wrappers over the C# Web API endpoints. One function per route. */

export const authApi = {
  register: (fullName: string, email: string, password: string) =>
    api.post<LoginResponse>('/api/auth/register', { fullName, email, password }).then((r) => r.data),

  login: (email: string, password: string) =>
    api.post<LoginResponse>('/api/auth/login', { email, password }).then((r) => r.data),

  logout: (refreshToken: string) =>
    api.post('/api/auth/logout', { refreshToken }).then(() => undefined),

  changePassword: (currentPassword: string, newPassword: string) =>
    api
      .post('/api/auth/change-password', { currentPassword, newPassword })
      .then((r) => r.data),
};

export const meApi = {
  get: () => api.get<MyProfile>('/api/me').then((r) => r.data),
  update: (fullName: string) => api.put<MyProfile>('/api/me', { fullName }).then((r) => r.data),
};

export const devicesApi = {
  register: (token: string, platform: 'ios' | 'android' | 'web') =>
    api.post('/api/devices', { token, platform }).then(() => undefined),
};

export interface SubmitOptions {
  mode: 'melody' | 'poly';
  key?: string;
  tempo?: number;
}

export const transcriptionsApi = {
  /** Upload a captured clip as multipart/form-data; returns the polling job. */
  submit: (fileUri: string, fileName: string, opts: SubmitOptions) => {
    const form = new FormData();
    // React Native's FormData takes a {uri,name,type} blob descriptor.
    form.append('audio', {
      uri: fileUri,
      name: fileName,
      type: 'audio/m4a',
    } as unknown as Blob);
    form.append('mode', opts.mode);
    if (opts.key) form.append('key', opts.key);
    if (opts.tempo != null) form.append('tempo', String(opts.tempo));

    return api
      .post<TranscriptionJob>('/api/transcriptions', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      })
      .then((r) => r.data);
  },

  getJob: (jobId: string) =>
    api.get<TranscriptionJob>(`/api/transcriptions/jobs/${jobId}`).then((r) => r.data),
};

export const libraryApi = {
  list: () => api.get<SavedTranscription[]>('/api/library').then((r) => r.data),

  get: (id: string) => api.get<SavedTranscription>(`/api/library/${id}`).then((r) => r.data),

  save: (body: {
    title: string;
    key: string;
    tempoBpm: number;
    timeSignature: string;
    musicXml: string;
    notes: SavedTranscription['notes'];
    overallConfidence: number;
    sourceJobId?: string;
  }) => api.post<SavedTranscription>('/api/library', body).then((r) => r.data),

  rename: (id: string, title: string) =>
    api.put<SavedTranscription>(`/api/library/${id}/title`, { title }).then((r) => r.data),

  updateKey: (id: string, key: string) =>
    api.put<SavedTranscription>(`/api/library/${id}/key`, { key }).then((r) => r.data),

  remove: (id: string) => api.delete(`/api/library/${id}`).then(() => undefined),
};
