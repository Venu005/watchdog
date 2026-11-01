import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { latestOccurrence } from "../../src/domain/schedule";
test("an invited owner signs in, creates a monitor, sends a test and activates it", async ({
  page,
  request,
}) => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const email = `watchdog-e2e-${Date.now()}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw error;
  const publicAuth = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const attempt = await publicAuth.auth.signUp({
    email: "uninvited-" + Date.now() + "@example.test",
    password: randomUUID(),
  });
  expect(attempt.error).toBeTruthy();
  const db = postgres(process.env.DATABASE_URL!);
  const workspace = randomUUID();
  try {
    await db`insert into watchdog.workspaces(id,owner_id,owner_email,name) values(${workspace},${data.user!.id},${email},'Pilot Studio')`;
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await page.getByLabel("Work email").fill(email);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(
      page.getByText("If your workspace is provisioned"),
    ).toBeVisible();
    let messageId = "";
    await expect
      .poll(async () => {
        const res = await request.get(
          `${process.env.LOCAL_MAIL_URL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`,
        );
        const body = await res.json();
        messageId = body.messages?.[0]?.ID ?? "";
        return messageId;
      })
      .not.toBe("");
    const mail = await (
      await request.get(
        `${process.env.LOCAL_MAIL_URL}/api/v1/message/${messageId}`,
      )
    ).json();
    const link = String(mail.HTML).match(
      /href="([^"]*\/auth\/v1\/verify[^"]*)"/,
    )?.[1];
    expect(link).toBeTruthy();
    await page.goto(link!.replaceAll("&amp;", "&"));
    await expect(
      page.getByRole("heading", { name: "Your monitoring workspace" }),
    ).toBeVisible();
    await page.getByLabel("Client name").fill("Acme Agency");
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByText("Client added.")).toBeVisible();
    await page.getByRole("link", { name: "New monitor", exact: true }).click();
    await page.getByLabel("Monitor name").fill("Daily lead sync");
    await page.getByRole("button", { name: "Create monitor" }).click();
    const token = await page.getByTestId("setup-token").innerText();
    const monitorId = await page.getByTestId("monitor-id").innerText();
    const scheduled = latestOccurrence(
      { kind: "daily", hour: 9, minute: 0, graceMinutes: 10 },
      new Date(),
    ).toISOString();
    const result = await request.post(`/api/ingest/${monitorId}`, {
      headers: { Authorization: "Bearer " + token },
      data: {
        event_id: "e2e-test",
        config_version: 1,
        scheduled_for: scheduled,
        record_count: 1,
        fields: {},
        is_test: true,
      },
    });
    expect(result.status()).toBe(200);
    expect((await result.json()).result.kind).toBe("test");
    await page.getByRole("link", { name: "Open monitor" }).click();
    await expect(
      page.getByText("synthetic-test", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Activate monitor" }).click();
    await expect(
      page.getByText("Awaiting first run", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Next deadline", { exact: true }),
    ).toBeVisible();
    // Test fixture moves activation into the current window without waiting a day.
    await db`update watchdog.monitors set active_from=${new Date(scheduled)},config=jsonb_set(config,'{schedule,graceMinutes}','1439') where id=${monitorId}`;
    const failed = await request.post(`/api/ingest/${monitorId}`, {
      headers: { Authorization: "Bearer " + token },
      data: {
        event_id: "e2e-failure",
        config_version: 1,
        scheduled_for: scheduled,
        record_count: 0,
        fields: {},
        is_test: false,
      },
    });
    expect(failed.status()).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("cell", { name: "output-validation", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const mail = await (
            await request.get(
              `${process.env.LOCAL_MAIL_URL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`,
            )
          ).json();
          return mail.messages?.some(
            (m: { Subject: string }) =>
              m.Subject === "Action needed: Daily lead sync",
          );
        },
        { timeout: 20000 },
      )
      .toBe(true);
    const recovered = await request.post(`/api/ingest/${monitorId}`, {
      headers: { Authorization: "Bearer " + token },
      data: {
        event_id: "e2e-recovery",
        config_version: 1,
        scheduled_for: scheduled,
        record_count: 1,
        fields: {},
        is_test: false,
      },
    });
    expect(recovered.status()).toBe(200);
    await page.reload();
    await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
    await expect(page.getByText("resolved", { exact: true })).toBeVisible();
    await expect
      .poll(
        async () => {
          const mail = await (
            await request.get(
              `${process.env.LOCAL_MAIL_URL}/api/v1/search?query=${encodeURIComponent("to:" + email)}`,
            )
          ).json();
          return mail.messages?.some(
            (m: { Subject: string }) =>
              m.Subject === "Recovered: Daily lead sync",
          );
        },
        { timeout: 20000 },
      )
      .toBe(true);
    await page.goto("/dashboard");
    await page.screenshot({
      path: "test-results/overview-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "test-results/overview-mobile.png",
      fullPage: true,
    });
  } finally {
    await db`delete from watchdog.workspaces where id=${workspace}`;
    await db.end();
    await admin.auth.admin.deleteUser(data.user!.id);
  }
});
