import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// For GitHub Pages served at https://<user>.github.io/<repo>/,
// set VITE_BASE=/<repo>/ in CI (the deploy workflow does this automatically).
// Locally it falls back to "/".
export default defineConfig(() => ({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
}));
