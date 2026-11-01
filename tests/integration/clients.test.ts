import { it, expect } from "vitest";
import { fixture } from "../helpers/fixture";
import { randomUUID } from "node:crypto";
import {
  listClients,
  scopedClient,
  clientMonitors,
} from "../../src/server/clients";
it("lists clients even when they have no monitors", async () => {
  const f = await fixture();
  try {
    const empty = randomUUID();
    await f.db`insert into watchdog.clients(id,workspace_id,name) values(${empty},${f.ws},'Empty client')`;
    const rows = await listClients(f.ws);
    expect(rows).toHaveLength(2);
    expect(rows.find((c) => c.id === empty)).toMatchObject({
      name: "Empty client",
      monitor_count: 0,
    });
    expect(rows.find((c) => c.id === f.client)).toMatchObject({
      monitor_count: 1,
    });
  } finally {
    await f.cleanup();
  }
});
it("does not reveal another workspace client or its monitors", async () => {
  const a = await fixture(),
    b = await fixture();
  try {
    expect((await listClients(a.ws)).map((c) => c.id)).not.toContain(b.client);
    await expect(scopedClient(a.ws, b.client)).rejects.toThrow("not found");
    await expect(clientMonitors(a.ws, b.client)).rejects.toThrow("not found");
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});
it("returns a client monitor list without connection secrets", async () => {
  const f = await fixture();
  try {
    const rows = await clientMonitors(f.ws, f.client);
    expect(rows.map((m) => m.id)).toEqual([f.monitor]);
    expect(JSON.stringify(rows)).not.toContain("token_hash");
    expect(JSON.stringify(rows)).not.toContain(f.token);
  } finally {
    await f.cleanup();
  }
});

it("returns not found for malformed client identifiers", async () => {
  await expect(scopedClient(randomUUID(), "-".repeat(36))).rejects.toThrow(
    "Client not found",
  );
});
