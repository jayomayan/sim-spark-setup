import { describe, expect, it, vi } from "vitest";
import { checkOktaDiscovery } from "../lib/okta-connection.server";

const discovery = {
  issuer: "https://company.okta.com",
  authorization_endpoint: "https://company.okta.com/oauth2/v1/authorize",
  token_endpoint: "https://company.okta.com/oauth2/v1/token",
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
};

describe("Okta connection check", () => {
  it("accepts Authorization Code-only discovery without requesting another grant or sending credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(discovery));
    expect((await checkOktaDiscovery("company.okta.com", request)).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0];
    if (!call) throw new Error("Expected a discovery request");
    const [url, options] = call;
    expect(url).toBe("https://company.okta.com/.well-known/openid-configuration");
    expect(options?.redirect).toBe("manual");
    expect(options?.body).toBeUndefined();
    expect(options?.headers).toBeUndefined();
    expect(options?.method).toBeUndefined();
  });

  it("does not follow discovery redirects", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302 }));
    expect((await checkOktaDiscovery("company.okta.com", request)).ok).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a token endpoint on another origin", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...discovery, token_endpoint: "https://other.example/token" }));
    expect((await checkOktaDiscovery("company.okta.com", request)).ok).toBe(false);
  });

  it("rejects discovery without Authorization Code support", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...discovery, grant_types_supported: ["client_credentials"] }));
    expect((await checkOktaDiscovery("company.okta.com", request)).ok).toBe(false);
  });

  it("rejects non-OIDC responses", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    expect((await checkOktaDiscovery("company.okta.com", request)).ok).toBe(false);
  });
});