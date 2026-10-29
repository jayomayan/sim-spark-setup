import { createFileRoute } from "@tanstack/react-router";

// What the helper downloads from the console: current release + the files to install.
// Public by design — it only names files, never a credential.
export const Route = createFileRoute("/api/public/helper/version")({
  server: {
    handlers: {
      GET: async () => {
        const { HELPER_VERSION, HELPER_FILES } = await import("@/lib/helper-release");
        return Response.json({ version: HELPER_VERSION, files: HELPER_FILES });
      },
    },
  },
});
