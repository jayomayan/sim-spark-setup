import { z } from "zod";

export const integrationSchema = z.enum(["site_lookup", "sim_activation"]);
export type ConsoleIntegration = z.infer<typeof integrationSchema>;
export const CONSOLE_DEFAULTS = {
  site_lookup: { tokenUrl: "https://pccwg.iot.aeris.com/iot/api/auth/token", apiUrl: "https://iot-api.aeris.com/iot/api", clientId: "cm-public-api-client" },
  sim_activation: { tokenUrl: "", apiUrl: "", clientId: "" },
};
export const providerUrlSchema = z.string().trim().max(500).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === "443") &&
      ["aeris.com", "consoleconnect.com"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}, "Use an HTTPS Aeris or Console Connect address without credentials, query parameters or a custom port.");
export const consoleSettingsSchema = z.object({
  integration: integrationSchema,
  tokenUrl: z.string().default(""),
  apiUrl: providerUrlSchema,
  clientId: z.string().trim().max(100),
  username: z.string().trim().max(200).default(""),
  password: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  if (data.integration === "site_lookup") {
    if (!data.username) ctx.addIssue({ code: "custom", path: ["username"], message: "Username is required." });
    if (!providerUrlSchema.safeParse(data.tokenUrl).success) ctx.addIssue({ code: "custom", path: ["tokenUrl"], message: "Enter a valid HTTPS Console Connect token URL." });
    if (!data.clientId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Client ID is required." });
  }
});