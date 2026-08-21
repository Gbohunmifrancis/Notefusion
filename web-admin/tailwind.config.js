/** @type {import('tailwindcss').Config} */

// The palette is NoteFusion's, and the dashboard now carries the same light/dark switch
// the app does. Every colour that differs between the two modes resolves through a CSS
// variable defined in src/index.css (`:root` for light, `.dark` for dark) — components
// keep writing `bg-surface`, `text-muted`, `bg-danger/10` and never learn which mode
// they are in. The `rgb(... / <alpha-value>)` form is what keeps the `/10` opacity
// modifiers working through the indirection.
//
// Values are copied from the app (mobile/src/design/theme.ts), not reinterpreted. Where
// this file departs from the app's value the comment says why; the reason is always
// contrast at dashboard body size, which is smaller than the app's.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-alt": "rgb(var(--c-surface-alt) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        "border-light": "rgb(var(--c-border-light) / <alpha-value>)",

        // Brand blue does not flip. It is a fill that carries white text, and white on a
        // dark-mode-brightened blue measures 3.7:1 — so the fill stays put and the blue
        // that has to read as *text* on a dark ground is `accent` below. Both hexes are
        // real values from the app's dark palette (purpleDark, purple).
        blue: {
          DEFAULT: "#2563eb",
          deep: "#1d4ed8",
          bright: "#3b82f6",
        },

        // The blue that appears as text, as a glyph on a tint, or as a small graphic mark.
        // A fill blue and a text blue cannot be the same colour once the ground goes dark:
        // dark enough for white text on top is too dark to read as text itself. So this one
        // flips. `deep` is the label colour on an `accent/10` chip — at 11 px the DEFAULT
        // measures 4.4:1 on that tint in light mode, which is a badge just under AA.
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          deep: "rgb(var(--c-accent-deep) / <alpha-value>)",
        },

        sky: "rgb(var(--c-sky) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",

        // The dark ground for the sign-in value panel. Dark in both modes — it is a brand
        // surface, not a themed one — but pushed deeper in dark so it still separates from
        // the form panel beside it, which is no longer white.
        navy: {
          DEFAULT: "rgb(var(--c-navy) / <alpha-value>)",
          deep: "rgb(var(--c-navy-deep) / <alpha-value>)",
        },

        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",

        // Pro and gift badges, from the app's `premium` gold. `deep` is the label colour
        // on a `premium/10` chip; the fill colour itself does not clear AA as text on a
        // light surface, and a badge nobody can read is not a badge.
        premium: {
          DEFAULT: "rgb(var(--c-premium) / <alpha-value>)",
          deep: "rgb(var(--c-premium-deep) / <alpha-value>)",
        },

        // Status colours, split the same way and for the same reason as `accent` and
        // `premium` above: DEFAULT is the fill or the mark, `deep` is the same status
        // read as text. On its own /10 tint the fill measures 2.6–3.7:1 in light mode,
        // which is a label nobody can read. In dark mode `deep` is the fill value —
        // src/index.css says why.
        success: {
          DEFAULT: "rgb(var(--c-success) / <alpha-value>)",
          deep: "rgb(var(--c-success-deep) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--c-warning) / <alpha-value>)",
          deep: "rgb(var(--c-warning-deep) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--c-danger) / <alpha-value>)",
          deep: "rgb(var(--c-danger-deep) / <alpha-value>)",
        },
      },
      borderRadius: { sm: "8px", md: "14px", lg: "20px", xl: "28px", pill: "999px" },
      // The app's type scale, so a heading here is the same size as the same heading
      // there. Sizes only: line-height stays with the `leading-*` utility at the call
      // site, which is how these pages already set it.
      fontSize: {
        hero: ["40px", { letterSpacing: "-1px" }],
        display: ["34px", { letterSpacing: "-0.5px" }],
        "screen-title": ["26px", { letterSpacing: "-0.5px" }],
        title: ["24px", { letterSpacing: "-0.3px" }],
        heading: ["18px", {}],
        body: ["15px", {}],
        label: ["14px", {}],
        caption: ["12px", { letterSpacing: "0.2px" }],
        mono: ["17px", {}],
      },
      boxShadow: {
        // Panels are border-first: the hairline does the separating and the shadow only
        // lifts the card off the canvas by a pixel. `card` is the heavier version, kept
        // for the surfaces that float over content (tooltips use `lift`).
        //
        // Whole values, not just a colour, because dark mode needs more than a darker
        // rgba: a 4%-black shadow is invisible on a navy canvas, so the dark set trades
        // spread for opacity.
        hairline: "var(--shadow-hairline)",
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
        glow: "var(--shadow-glow)",
      },
      backgroundImage: {
        fusion: "linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)",
        // Text sits on this one, so it stops at the contrast-safe blue.
        "fusion-contrast": "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
      },
      fontFamily: { sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"] },
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
