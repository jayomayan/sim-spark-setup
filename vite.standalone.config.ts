import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Explicitly selected only by build:standalone; the hosted app keeps its target.
export default defineConfig({
  nitro: { preset: "node-server" },
  tanstackStart: { server: { entry: "server" } },
  vite: { envDir: "deploy/env", envPrefix: "VITE_" },
});