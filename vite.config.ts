/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static build; relative base so it works from GitHub Pages sub-paths.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 900 },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
