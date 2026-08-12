import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Port 5173 is not incidental: it is the origin listed in the API's
// Cors:AllowedOrigins (appsettings.Development.json). Change one and change both,
// or the browser blocks every call with an opaque CORS error.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: { port: 5173, strictPort: true },
});
