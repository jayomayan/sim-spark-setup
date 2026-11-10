// Single source of truth for the helper release the console serves from public/helper.
// The helper compares this with its own VERSION and updates itself when they differ.
export const HELPER_VERSION = "1.9.6";

// Files the installer copies onto the helper machine. install.sh is fetched separately by curl.
export const HELPER_FILES = ["field-ops-helper.mjs", "router-ssh.mjs", "package.json", "README.md"] as const;
