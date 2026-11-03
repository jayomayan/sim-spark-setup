import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { validateEnvironment } from "./config.mjs";

const errors = validateEnvironment(process.env, { runtime: true });
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
const url = process.env.SUPABASE_URL;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = (key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers, signal: AbortSignal.timeout(10000) });
  } },
});
const admin = client(adminKey);
const anonymous = client(publicKey);
let failed = false;
function report(label, ok) { console.log(`${ok ? "PASS" : "FAIL"} ${label}`); if (!ok) failed = true; }
try {
  const build = JSON.parse(readFileSync(".output/standalone.json", "utf8"));
  report("Browser build matches this backend", build.publicUrl === process.env.VITE_SUPABASE_URL && build.publicKey === publicKey);
} catch { report("Standalone browser build exists", false); }
try {
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publicKey }, signal: AbortSignal.timeout(10000) });
  report("Authentication service reachable", response.ok);
} catch { report("Authentication service reachable", false); }
for (const table of ["profiles", "user_roles", "devices", "sim_activations", "agent_jobs", "agent_status", "database_connections", "console_connect_settings", "site_checks", "okta_settings", "helper_settings", "helper_enrollments"]) {
  const { error } = await admin.from(table).select("*", { head: true, count: "exact" });
  report(`Administrative access to ${table}`, !error);
  const denied = await anonymous.from(table).select("*", { head: true, count: "exact" });
  report(`Anonymous access denied or empty for ${table}`, Boolean(denied.error) || denied.count === 0);
}
const { count, error } = await admin.from("user_roles").select("*", { head: true, count: "exact" }).eq("role", "admin");
report("An administrator has been provisioned", !error && (count ?? 0) > 0);
console.log("These checks do not verify email delivery, Okta login, Console Connect or real router/SIM jobs. Complete the acceptance checklist on the VM.");
process.exitCode = failed ? 1 : 0;