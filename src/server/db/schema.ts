import {
  pgSchema,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const schema = pgSchema("watchdog");
const id = () => uuid("id").defaultRandom().primaryKey();
const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
export const workspaces = schema.table("workspaces", {
  id: id(),
  ownerId: uuid("owner_id").notNull().unique(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  monitorLimit: integer("monitor_limit").notNull().default(3),
  credentials: text("credentials"),
  createdAt: at("created_at").defaultNow().notNull(),
});
export const clients = schema.table("clients", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: at("created_at").defaultNow().notNull(),
});
export const monitors = schema.table("monitors", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: jsonb("config").notNull(),
  tokenHash: text("token_hash").notNull(),
  active: boolean("active").notNull().default(false),
  activeFrom: at("active_from"),
  status: text("status").notNull().default("paused"),
  evidence: text("evidence"),
  qualifiedFor: at("qualified_for"),
  lastSignalAt: at("last_signal_at"),
  createdAt: at("created_at").defaultNow().notNull(),
});
export const signals = schema.table(
  "signals",
  {
    id: id(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    version: integer("version").notNull(),
    payloadHash: text("payload_hash").notNull(),
    scheduledFor: at("scheduled_for").notNull(),
    recordCount: integer("record_count").notNull(),
    isTest: boolean("is_test").notNull(),
    kind: text("kind").notNull(),
    evidence: text("evidence"),
    reason: text("reason"),
    receivedAt: at("received_at").notNull(),
  },
  (t) => [
    uniqueIndex("monitor_event").on(t.monitorId, t.eventId),
    index("signal_retention").on(t.receivedAt),
  ],
);
export const incidents = schema.table(
  "incidents",
  {
    id: id(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("open"),
    reason: text("reason").notNull(),
    evidence: text("evidence"),
    openedAt: at("opened_at").notNull(),
    closedAt: at("closed_at"),
  },
  (t) => [
    uniqueIndex("one_open_incident")
      .on(t.monitorId)
      .where(sql`${t.status} = 'open'`),
  ],
);
export const jobs = schema.table(
  "jobs",
  {
    id: id(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").unique().notNull(),
    dueAt: at("due_at").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: uuid("lease_token"),
    leaseUntil: at("lease_until"),
    error: text("error"),
    providerId: text("provider_id"),
    createdAt: at("created_at").defaultNow().notNull(),
  },
  (t) => [index("job_ready").on(t.status, t.dueAt)],
);
export const rateBuckets = schema.table(
  "rate_buckets",
  {
    key: text("key").notNull(),
    bucket: at("bucket").notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.key, t.bucket] })],
);
export const workers = schema.table("workers", {
  id: text("id").primaryKey(),
  lastSeen: at("last_seen").notNull(),
});
