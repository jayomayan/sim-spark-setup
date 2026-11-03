export function validateEnvironment(env, { runtime = false } = {}) {
  const errors = [];
  const required = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (runtime) required.push("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DB_SECRET_KEY");
  for (const key of required) if (!env[key]?.trim()) errors.push(`${key} is required`);
  for (const key of ["VITE_SUPABASE_URL", ...(runtime ? ["SUPABASE_URL"] : [])]) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) errors.push(`${key} must use HTTPS or loopback HTTP`);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") errors.push(`${key} must be an API origin without credentials or a path`);
      if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".lovable.app")) errors.push(`${key} still targets hosted infrastructure, not the standalone backend`);
    } catch { errors.push(`${key} must be a valid URL`); }
  }
  const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (publicKey?.startsWith("sb_secret_")) errors.push("The browser key cannot be an administrative key");
  if (publicKey?.split(".").length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString());
      if (claims.role !== "anon") errors.push("The browser JWT key must have the anon role");
    } catch { errors.push("The browser JWT key is malformed"); }
  }
  if (runtime && env.SUPABASE_PUBLISHABLE_KEY !== publicKey) errors.push("Browser and server public keys must match");
  if (runtime && env.SUPABASE_SERVICE_ROLE_KEY === publicKey) errors.push("The server administrative key must differ from the browser key");
  if (runtime && (env.DB_SECRET_KEY?.length ?? 0) < 32) errors.push("DB_SECRET_KEY must contain at least 32 characters");
  for (const key of Object.keys(env)) if (key.startsWith("VITE_") && /SECRET|PASSWORD|SERVICE_ROLE|TOKEN/i.test(key)) errors.push(`${key} cannot be exposed to the browser`);
  return errors;
}