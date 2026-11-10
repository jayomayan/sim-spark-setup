import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readActivationReports } from "@/lib/activation-reports";

export const listActivationReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { page: number; search?: string }) => z.object({ page: z.number().int().min(0).max(1000000), search: z.string().max(100).optional() }).parse(input))
  .handler(({ data, context }) => readActivationReports(context.supabase, context.userId, data.page, data.search ?? ""));