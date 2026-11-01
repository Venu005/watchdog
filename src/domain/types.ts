import { z } from "zod";
export const scheduleSchema = z.object({
  kind: z.enum(["hourly", "daily", "weekdays"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  graceMinutes: z.number().int().min(1).max(1439),
});
export const sheetSchema = z.object({
  spreadsheetId: z.string().regex(/^[a-zA-Z0-9_-]{10,200}$/),
  tab: z.string().min(1).max(100),
  idColumn: z.number().int().min(0).max(25),
  timestampColumn: z.number().int().min(0).max(25),
  requiredColumns: z.array(z.number().int().min(0).max(25)).max(26),
  expectedRows: z.number().int().min(1).max(100),
});
export const monitorSchema = z.object({
  version: z.number().int().positive().default(1),
  schedule: scheduleSchema,
  requiredFields: z
    .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/))
    .max(20)
    .default([]),
  minimumCount: z.number().int().min(0).max(1000000).default(1),
  sheet: sheetSchema.optional(),
});
export type MonitorConfig = z.infer<typeof monitorSchema>;
export type Evaluation = {
  testOutcome?: "pass" | "fail" | "pending";
  kind: "pass" | "fail" | "pending" | "late" | "reject" | "test";
  evidence?:
    | "workflow-reported"
    | "destination-verified"
    | "pending-verification"
    | "verification-unavailable"
    | "destination-mismatch";
  reason?: string;
};
export type SheetConfig = z.infer<typeof sheetSchema>;
