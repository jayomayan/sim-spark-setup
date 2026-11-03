import { readFileSync } from "node:fs";
import { validateEnvironment } from "./config.mjs";

const errors = validateEnvironment(process.env, { runtime: true });
try {
  const build = JSON.parse(readFileSync(".output/standalone.json", "utf8"));
  if (build.publicUrl !== process.env.VITE_SUPABASE_URL || build.publicKey !== process.env.VITE_SUPABASE_PUBLISHABLE_KEY) errors.push("The browser configuration changed; run build:standalone again before starting");
} catch { errors.push("A standalone build is required before startup"); }
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
process.env.HOST ??= "127.0.0.1";
process.env.PORT ??= "3000";
await import("../.output/server/index.mjs");