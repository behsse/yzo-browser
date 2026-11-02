import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the production build loads from file:// inside Electron.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  // CI runners (Windows above all) can take seconds on a first call, such as loading the ICU locale data
  // behind toLocaleDateString: the default 5 s timeout made the release build fail at random.
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: process.env.CI ? 30_000 : 5_000 },
});
