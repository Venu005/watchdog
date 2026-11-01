CREATE SCHEMA IF NOT EXISTS watchdog;
CREATE TABLE "watchdog"."clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchdog"."incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"evidence" text,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watchdog"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"error" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "watchdog"."monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"active_from" timestamp with time zone,
	"status" text DEFAULT 'paused' NOT NULL,
	"evidence" text,
	"qualified_for" timestamp with time zone,
	"last_signal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchdog"."rate_buckets" (
	"key" text NOT NULL,
	"bucket" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rate_buckets_key_bucket_pk" PRIMARY KEY("key","bucket")
);
--> statement-breakpoint
CREATE TABLE "watchdog"."signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"version" integer NOT NULL,
	"payload_hash" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"record_count" integer NOT NULL,
	"is_test" boolean NOT NULL,
	"kind" text NOT NULL,
	"evidence" text,
	"reason" text,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchdog"."workers" (
	"id" text PRIMARY KEY NOT NULL,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchdog"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_email" text NOT NULL,
	"name" text NOT NULL,
	"monitor_limit" integer DEFAULT 3 NOT NULL,
	"credentials" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
ALTER TABLE "watchdog"."clients" ADD CONSTRAINT "clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "watchdog"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchdog"."incidents" ADD CONSTRAINT "incidents_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "watchdog"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchdog"."jobs" ADD CONSTRAINT "jobs_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "watchdog"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchdog"."monitors" ADD CONSTRAINT "monitors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "watchdog"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchdog"."monitors" ADD CONSTRAINT "monitors_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "watchdog"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchdog"."signals" ADD CONSTRAINT "signals_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "watchdog"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_incident" ON "watchdog"."incidents" USING btree ("monitor_id") WHERE "watchdog"."incidents"."status" = 'open';--> statement-breakpoint
CREATE INDEX "job_ready" ON "watchdog"."jobs" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_event" ON "watchdog"."signals" USING btree ("monitor_id","event_id");--> statement-breakpoint
CREATE INDEX "signal_retention" ON "watchdog"."signals" USING btree ("received_at");
REVOKE ALL ON SCHEMA watchdog FROM PUBLIC;
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='watchdog_server') THEN CREATE ROLE watchdog_server NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA watchdog TO watchdog_server;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA watchdog TO watchdog_server;
ALTER DEFAULT PRIVILEGES IN SCHEMA watchdog GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO watchdog_server;
