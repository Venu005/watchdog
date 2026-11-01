import { GoogleAuth } from "google-auth-library";
import { sheetSchema, type SheetConfig } from "../domain/types";
export type VerificationResult = {
  kind: "pass" | "fail" | "error";
  reason?: string;
};
export function sheetRange(config: SheetConfig) {
  return "'" + config.tab.replaceAll("'", "''") + "'!A1:Z5001";
}
export function checkRows(
  config: SheetConfig,
  eventId: string,
  start: Date,
  end: Date,
  rows: unknown[][],
): VerificationResult {
  if (rows.length > 5000)
    return { kind: "error", reason: "tab-limit-exceeded" };
  const matches = rows
    .slice(1)
    .filter((row) => row[config.idColumn] === eventId);
  if (matches.length !== config.expectedRows)
    return { kind: "fail", reason: "row-count-mismatch" };
  for (const row of matches) {
    const stamp = row[config.timestampColumn];
    const time =
      typeof stamp === "string" && stamp.endsWith("Z")
        ? Date.parse(stamp)
        : NaN;
    if (
      !Number.isFinite(time) ||
      time < start.getTime() ||
      time >= end.getTime()
    )
      return { kind: "fail", reason: "timestamp-mismatch" };
    if (
      config.requiredColumns.some(
        (i) =>
          row[i] === null ||
          row[i] === undefined ||
          String(row[i]).trim() === "",
      )
    )
      return { kind: "fail", reason: "required-cell-empty" };
  }
  return { kind: "pass" };
}
export async function verifySheet(
  raw: SheetConfig,
  eventId: string,
  start: Date,
  end: Date,
  credentials: Record<string, string>,
): Promise<VerificationResult> {
  try {
    const config = sheetSchema.parse(raw);
    if (!credentials.client_email || !credentials.private_key)
      return { kind: "error", reason: "credentials-missing" };
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      clientOptions: { transporterOptions: { timeout: 10000, retry: false } },
    });
    const client = await auth.getClient();
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(config.spreadsheetId) +
      "/values/" +
      encodeURIComponent(sheetRange(config));
    const { data } = await client.request<{ values?: unknown[][] }>({
      url,
      timeout: 10000,
      retry: false,
      params: {
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      },
    });
    if (data.values && !Array.isArray(data.values))
      return { kind: "error", reason: "invalid-upstream-response" };
    return checkRows(config, eventId, start, end, data.values ?? []);
  } catch {
    return { kind: "error", reason: "verification-unavailable" };
  }
}
