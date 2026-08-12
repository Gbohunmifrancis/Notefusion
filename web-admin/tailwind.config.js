/** @type {import('tailwindcss').Config} */

// The palette is NoteFusion's, copied from web-site/assets/theme.css so the dashboard
// reads as the same product as the site and the app. Values are copied, not
// reinterpreted — if a token changes there, change it here.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f4f7fc",
        surface: "#ffffff",
        "surface-alt": "#eef3fb",
        border: "#e2e8f0",
        "border-light": "#eff3f9",
        blue: {
          DEFAULT: "#2563eb",
          deep: "#1d4ed8",
          bright: "#3b82f6",
        },
        sky: "#0ea5e9",
        ink: "#0f172a",
        // The dark ground for the login value-panel — deeper than `ink` so the
        // brand glows and white text read as a distinct, premium surface.
        navy: { DEFAULT: "#0b1736", deep: "#070f24" },
        // Darkened from the app's #64748b: at dashboard body size the app value
        // measures 4.43:1 on Mist and fails AA. This clears 4.5:1 on every surface here.
        muted: "#5d6d82",
        faint: "#94a3b8",
        success: "#16a34a",
        warning: "#d97706",
        danger: "#dc2626",
      },
      borderRadius: { sm: "8px", md: "14px", lg: "20px", xl: "28px", pill: "999px" },
      boxShadow: {
        card: "0 2px 10px rgba(15, 23, 42, 0.06)",
        lift: "0 12px 32px rgba(15, 23, 42, 0.10)",
        glow: "0 8px 20px rgba(37, 99, 235, 0.28)",
      },
      backgroundImage: {
        fusion: "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)",
        // Text sits on this one, so it stops at the contrast-safe blue.
        "fusion-contrast": "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: { "fade-in": "fade-in 0.25s ease-out" },
    },
  },
  plugins: [],
};
