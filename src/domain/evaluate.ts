import { z } from "zod";
import { getWindow } from "./schedule";
import type { MonitorConfig, Evaluation } from "./types";
export const signalSchema = z
  .object({
    event_id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    config_version: z.number().int().positive(),
    scheduled_for: z.iso.datetime(),
    occurred_at: z.iso.datetime().optional(),
    record_count: z.number().int().min(0).max(1000000),
    fields: z
      .record(
        z.string().max(64),
        z.union([
          z.string().max(256),
          z.number().finite(),
          z.boolean(),
          z.null(),
        ]),
      )
      .refine((v) => Object.keys(v).length <= 20),
    is_test: z.boolean().default(false),
  })
  .strict();
export type SignalInput = z.infer<typeof signalSchema>;
export function evaluateSignal(
  config: MonitorConfig,
  signal: SignalInput,
  receivedAt: Date,
): Evaluation {
  if (signal.config_version !== config.version)
    return { kind: "reject", reason: "stale-configuration" };
  let window;
  try {
    window = getWindow(config.schedule, new Date(signal.scheduled_for));
  } catch {
    return { kind: "reject", reason: "invalid-occurrence" };
  }
  if (signal.is_test) return { kind: "test", reason: "synthetic-test" };
  if (receivedAt < window.start)
    return { kind: "reject", reason: "early-result" };
  if (receivedAt >= window.end)
    return { kind: "late", reason: "expired-window" };
  const missing = config.requiredFields.some((k) => {
    if (!Object.hasOwn(signal.fields, k)) return true;
    const v = signal.fields[k];
    return (
      v === undefined || v === null || (typeof v === "string" && !v.trim())
    );
  });
  if (signal.record_count < config.minimumCount || missing)
    return { kind: "fail", reason: "output-validation" };
  return config.sheet
    ? { kind: "pending", evidence: "pending-verification" }
    : { kind: "pass", evidence: "workflow-reported" };
}
