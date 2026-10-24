import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the production build loads from file:// inside Electron.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
