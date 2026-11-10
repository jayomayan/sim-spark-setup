import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("connectivity settings database permissions", () => {
  it("lets admins save entries while operators can only read them", async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
        CREATE FUNCTION public.is_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
        CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.admin', true) = 'yes' $$;
        GRANT USAGE ON SCHEMA auth TO authenticated;`);
      await db.exec(readFileSync("drizzle/migrations/0014_site_connectivity_settings.sql", "utf8"));
      await db.exec(`SET ROLE authenticated; SET test.admin = 'yes'; INSERT INTO public.site_connectivity_settings(id, targets) VALUES (1, '[{"port":9000,"protocol":"https"}]');`);
      await db.exec(`SET test.admin = 'no';`);
      const result = await db.query<{ targets: unknown }>("SELECT targets FROM public.site_connectivity_settings WHERE id = 1");
      expect(result.rows[0]?.targets).toEqual([{ port: 9000, protocol: "https" }]);
      const update = await db.query("UPDATE public.site_connectivity_settings SET targets = '[]' RETURNING id");
      expect(update.rows).toEqual([]);
      await expect(db.exec("INSERT INTO public.site_connectivity_settings(id) VALUES (1) ON CONFLICT(id) DO UPDATE SET targets = '[]'")).rejects.toThrow();
      await db.exec(`SET test.admin = 'yes'; UPDATE public.site_connectivity_settings SET targets = '[]';`);
      const cleared = await db.query<{ targets: unknown }>("SELECT targets FROM public.site_connectivity_settings");
      expect(cleared.rows[0]?.targets).toEqual([]);
    } finally { await db.close(); }
  });
});