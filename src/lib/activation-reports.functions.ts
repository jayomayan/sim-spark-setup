import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { exportActivationReports, readActivationReports } from "@/lib/activation-reports";

const reportFilter = z.object({
  page: z.number().int().min(0).max(1000000),
  search: z.string().max(100).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

export const listActivationReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { page: number; search?: string; from?: string; to?: string }) => reportFilter.parse(input))
  .handler(({ data, context }) => readActivationReports(context.supabase, context.userId, data.page, data.search ?? "", data.from ?? "", data.to ?? ""));

const exportFilter = z.object({
  search: z.string().max(100).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

export const exportActivationReportsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { search?: string; from?: string; to?: string }) => exportFilter.parse(input))
  .handler(({ data, context }) => exportActivationReports(context.supabase, context.userId, data.search ?? "", data.from ?? "", data.to ?? ""));
