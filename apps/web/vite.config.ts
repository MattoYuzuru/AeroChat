import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import { lazyModuleUrls } from "./build/lazy-module-urls.mjs";

export default defineConfig({
  plugins: [react(), lazyModuleUrls()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  test: {
    environment: "node",
  },
});
