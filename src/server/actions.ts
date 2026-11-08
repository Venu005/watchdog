"use server";

import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { assertSameOrigin } from "./origin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authClient, requireWorkspace } from "./auth";
import { getDb } from "./db";
import {
  createClient,
  createMonitor,
  updateMonitor,
  pauseMonitor,
  activateMonitor,
  rotateToken,
} from "./monitors";
import { rateLimit } from "./rate-limit";
import { hashToken } from "./secrets";
import { ServiceError } from "./errors";
import { logger } from "./logger";
export type FormState = {
  error?: string;
  message?: string;
  id?: string;
  token?: string;
};

async function sameOrigin(action: string) {
  const h = await headers();
  const origin = h.get("origin");
  const log = logger.child({
    action,
    requestId: h.get("x-request-id") ?? randomUUID(),
  });
  try {
    assertSameOrigin(origin, process.env.APP_URL!);
  } catch (error) {
    log.warn("request.origin_rejected", { origin: origin ?? "absent" });
    throw error;
  }
  return log;
}

const safeError = (e: unknown) =>
  e instanceof ServiceError
    ? e.message
    : "Check the supplied values and try again.";
export async function loginAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  let log = logger;
  try {
    log = await sameOrigin("login.request");
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { error: "Enter a valid email address." };
    await rateLimit("auth:global", 30);
    await rateLimit("auth:" + hashToken(email), 3);
    const [owner] =
      await getDb()`select id from watchdog.workspaces where owner_email=${email}`;
    if (owner) {
      const auth = await authClient();
      await auth.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: process.env.APP_URL + "/auth/callback",
        },
      });
    }
    log.info("login.request_accepted", {
      provisionedWorkspace: Boolean(owner),
    });
    return {
      message:
        "If your workspace is provisioned, a sign-in link is on its way.",
    };
  } catch (e) {
    log.error("login.request_failed", e);
    return {
      error: "Unable to request a sign-in link. Please try again shortly.",
    };
  }
}
export async function clientAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  let log = logger;
  try {
    log = await sameOrigin("client.create");
    const { workspaceId } = await requireWorkspace();
    await createClient(workspaceId, String(form.get("name") ?? ""));
    log.info("client.created", { workspaceId });
    revalidatePath("/dashboard");
    revalidatePath("/clients");
    return { message: "Client added." };
  } catch (e) {
    log.error("client.create_failed", e);
    return { error: safeError(e) };
  }
}
function readConfig(form: FormData) {
  const base = {
    version: 1,
    schedule: {
      kind: String(form.get("kind") ?? "daily"),
      hour: Number(form.get("hour") ?? 9),
      minute: Number(form.get("minute") ?? 0),
      graceMinutes: Number(form.get("grace") ?? 10),
    },
    minimumCount: Number(form.get("minimumCount") ?? 1),
    requiredFields: String(form.get("requiredFields") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (form.get("useSheet") !== "on") return base;
  return {
    ...base,
    sheet: {
      spreadsheetId: String(form.get("spreadsheetId") ?? ""),
      tab: String(form.get("tab") ?? ""),
      idColumn: Number(form.get("idColumn") ?? 0),
      timestampColumn: Number(form.get("timestampColumn") ?? 1),
      requiredColumns: String(form.get("requiredColumns") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
      expectedRows: Number(form.get("expectedRows") ?? 1),
    },
  };
}
export async function monitorAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  let log = logger;
  try {
    log = await sameOrigin("monitor.save");
    const { workspaceId } = await requireWorkspace();
    const id = String(form.get("id") ?? "");
    if (id) {
      await updateMonitor(
        workspaceId,
        id,
        String(form.get("name")),
        readConfig(form),
      );
      log.info("monitor.updated", { monitorId: id, workspaceId });
      revalidatePath("/monitors/" + id);
      return {
        message:
          "Rules updated. Copy the refreshed n8n example for this configuration version.",
      };
    }
    const result = await createMonitor(
      workspaceId,
      String(form.get("clientId")),
      String(form.get("name")),
      readConfig(form),
    );
    log.info("monitor.created", { monitorId: result.id, workspaceId });
    revalidatePath("/dashboard");
    revalidatePath("/clients");
    return result;
  } catch (e) {
    log.error("monitor.save_failed", e);
    return { error: safeError(e) };
  }
}
export async function toggleAction(form: FormData) {
  let log = logger;
  try {
    log = await sameOrigin("monitor.toggle");
    const { workspaceId } = await requireWorkspace();
    const id = String(form.get("id"));
    if (form.get("intent") === "pause") await pauseMonitor(workspaceId, id);
    else await activateMonitor(workspaceId, id);
    log.info("monitor.toggled", {
      monitorId: id,
      intent: form.get("intent") === "pause" ? "pause" : "activate",
      workspaceId,
    });
    revalidatePath("/dashboard");
    revalidatePath("/monitors/" + id);
  } catch (error) {
    log.error("monitor.toggle_failed", error);
    throw error;
  }
}
export async function rotateAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  let log = logger;
  try {
    log = await sameOrigin("monitor.rotate_token");
    const { workspaceId } = await requireWorkspace();
    const id = String(form.get("id"));
    const token = await rotateToken(workspaceId, id);
    log.info("monitor.token_rotated", { monitorId: id, workspaceId });
    return { id, token };
  } catch (e) {
    log.error("monitor.rotate_token_failed", e);
    return { error: safeError(e) };
  }
}
export async function emailAction(
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  let log = logger;
  try {
    log = await sameOrigin("account.email_change");
    await requireWorkspace();
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { error: "Enter a valid email address." };
    const auth = await authClient();
    const { error } = await auth.auth.updateUser(
      { email },
      { emailRedirectTo: process.env.APP_URL + "/auth/callback" },
    );
    if (error) return { error: "Email change could not be requested." };
    log.info("account.email_change_requested");
    return {
      message:
        "Confirm the email change using the verification messages. Alerts continue to your current verified email until confirmation.",
    };
  } catch (e) {
    log.error("account.email_change_failed", e);
    return { error: safeError(e) };
  }
}
export async function signoutAction() {
  await sameOrigin("auth.signout");
  const auth = await authClient();
  await auth.auth.signOut();
  redirect("/login");
}
