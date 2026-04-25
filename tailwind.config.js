/** @type {import('tailwindcss').Config} */
//
// Color tokens are wired through CSS variables so dark mode can flip the
// whole palette without sprinkling `dark:` prefixes across every component.
// The `rgb(var(--token) / <alpha-value>)` pattern is what lets utilities
// like `bg-ink-50/60` keep working — Tailwind injects the alpha into the
// rgb() call. The actual numeric values live in src/index.css under :root
// (light) and .dark (dark) selectors.
//
// `surface` is a separate token specifically for the chrome layer (sidebar,
// cards, modals, inputs) — anywhere we used to write `bg-white`. In dark
// mode it becomes a near-black; in light mode it stays white. Keeps the
// rest of the UI from needing per-class dark variants.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          50: "rgb(var(--ink-50) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
        },
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
        // Replacement for `bg-white` everywhere in the app — flips to a
        // dark surface in dark mode while light/dark text still resolves
        // correctly via the ink scale.
        surface: "rgb(var(--surface) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
      },
    },
  },
  plugins: [],
};
