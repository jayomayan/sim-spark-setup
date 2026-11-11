import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";
import { appVersion } from "./scripts/app-version.mjs";

// Separate standard Node configuration; never changes the hosted build target.
export default defineConfig(({ command }) => ({
  envDir: "deploy/env",
  envPrefix: "VITE_",
  css: { transformer: "lightningcss" },
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  resolve: {
    alias: [
      { find: /^\.\/previewAuthStorage$/, replacement: fileURLToPath(new URL("./deploy/auth-storage.ts", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      server: { entry: "server" },
      importProtection: { behavior: "error", client: { files: ["**/server/**"], specifiers: ["server-only"] } },
    }),
    ...(command === "build" ? nitro({ preset: "node-server" }) : []),
    react(),
  ],
}));