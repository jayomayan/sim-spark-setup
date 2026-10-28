export const OIDC_CALLBACK_PATH = "/auth/v1/callback";

/**
 * Normalizes an Okta domain to a bare hostname.
 * Accepts "https://company.okta.com", "company.okta.com/", "company.okte.com/oauth2" style input.
 * Returns null when the value isn't a plausible hostname.
 */
export function normalizeOktaDomain(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (!trimmed || trimmed.length > 253) return null;
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (!new RegExp(`^${label}(?:\\.${label})+$`).test(trimmed)) return null;
  return trimmed;
}
