# NoteFusion — mobile client (Expo / React Native)

The cross-platform client for NoteFusion. Talks only to the C# Web API
(`../src`), which is the single gateway to the Python ML service.

## Stack

- **Expo SDK 52** (React Native 0.76, new architecture) + TypeScript (strict)
- **@react-navigation** native-stack + bottom-tabs
- **axios** with a JWT access/refresh interceptor (`src/api/client.ts`)
- **expo-secure-store** for the token vault, **expo-av** for capture,
  **expo-notifications** for push
- Icons: **Lucide** (ISC) for the generic ones and our own music glyphs (`assets/icons-src/notefusion`), baked into
  `src/design/iconGlyphs.ts` by `npm run build:icons` and drawn by `components/Icon` on react-native-svg — no icon
  font, no proprietary packs (`@expo/vector-icons` stays only for the store-art tool in `store/`)

## Layout

```
src/
  api/         wire types, axios client (refresh), typed endpoints
  components/  design-system primitives (Button, Card, TextField, …)
  design/      theme tokens — the single source of visual truth
  lib/         auth context, secure token store, push, job-polling hook
  navigation/  auth stack, tab navigator, root switch
  screens/     Splash, Onboarding, Login, Register, Home, Record,
               Result, Library, Profile
```

## Run

```bash
npm install
npm start          # Expo dev server; press a (Android) / i (iOS)
npm run lint       # tsc --noEmit (type-check only)
```

## Configuration

The API base URL comes from `app.json` → `expo.extra.apiBaseUrl`.
Defaults to `http://10.0.2.2:5080` (the Android emulator's alias for the host
machine's `localhost`). For a physical device, set it to your machine's LAN IP.

## Notes

- The app is dark-themed end to end; there is no white loading flash (a branded
  `SplashScreen` covers session restore).
- Confidence is surfaced honestly per the PRD — see `ConfidenceBadge` and the
  per-note coloring on the Result screen.
