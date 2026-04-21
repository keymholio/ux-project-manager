/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral, modern base — easy to re-skin once Figma screenshots arrive.
        ink: {
          50: "#f7f7f8",
          100: "#eeeef1",
          200: "#dcdce3",
          300: "#b9b9c6",
          400: "#8b8ba0",
          500: "#5e5e78",
          600: "#3f3f5a",
          700: "#2a2a42",
          800: "#1a1a2e",
          900: "#0e0e1f",
        },
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
        },
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
