import postgres from "postgres";
let client: ReturnType<typeof postgres> | undefined;
export function getDb() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    client = postgres(url, {
      max: 8,
      prepare: false,
      idle_timeout: 10,
      connect_timeout: 10,
    });
  }
  return client;
}
export async function closeDb() {
  if (client) {
    await client.end();
    client = undefined;
  }
}
export type Tx = postgres.TransactionSql;
export type MonitorRow = {
  id: string;
  workspace_id: string;
  client_id: string;
  name: string;
  config: import("../../domain/types").MonitorConfig;
  token_hash: string;
  active: boolean;
  active_from: Date | null;
  status: string;
  evidence: string | null;
  qualified_for: Date | null;
  last_signal_at: Date | null;
  created_at: Date;
};
