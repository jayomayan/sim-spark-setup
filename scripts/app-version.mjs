// Automatic app version: UTC build date plus the short git commit when available,
// e.g. 2026.11.11+a1b2c3d. Falls back to the date alone outside a git checkout.
import { execSync } from "node:child_process";

export function appVersion(now = new Date()) {
  const date = `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`;
  try {
    const sha = execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return sha ? `${date}+${sha}` : date;
  } catch {
    return date;
  }
}
