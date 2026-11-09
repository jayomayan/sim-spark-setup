import { z } from "zod";

const discoverySchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  response_types_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()).optional(),
});

/** Discovery is a reachability check, not proof of client authentication. */
export async function checkOktaDiscovery(domain: string, request: typeof fetch = fetch) {
  const origin = `https://${domain}`;
  try {
    const response = await request(`${origin}/.well-known/openid-configuration`, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, message: "Okta redirected the discovery request — check the base URL." };
    }
    if (!response.ok) return { ok: false, message: `Okta answered with status ${response.status} — check the base URL.` };
    const parsed = discoverySchema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, message: "The base URL didn't return valid OIDC discovery data." };
    const doc = parsed.data;
    if ([doc.issuer, doc.authorization_endpoint, doc.token_endpoint].some((url) => new URL(url).origin !== origin)) {
      return { ok: false, message: "Okta discovery returned a different domain — check the base URL." };
    }
    if (!doc.response_types_supported.includes("code") || (doc.grant_types_supported && !doc.grant_types_supported.includes("authorization_code"))) {
      return { ok: false, message: "This Okta server doesn't advertise Authorization Code sign-in support." };
    }
    return {
      ok: true,
      message: "Okta is reachable and supports Authorization Code sign-in. The client ID, secret and redirect URI remain unverified — complete Sign in with Okta to verify them.",
    };
  } catch {
    return { ok: false, message: "Couldn't read Okta discovery data — check the base URL and connection." };
  }
}