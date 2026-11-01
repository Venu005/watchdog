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
    const sessionCookies = (await page.context().cookies())
      .filter((c) => /auth-token(?:\.\d+)?$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const stored = sessionCookies.map((c) => c.value).join("");
    expect(stored.startsWith("base64-")).toBe(true);
    const expired = JSON.parse(
      Buffer.from(stored.slice(7), "base64url").toString(),
    );
    expired.expires_at = Math.floor(Date.now() / 1000) - 60;
    const expiredValue =
      "base64-" + Buffer.from(JSON.stringify(expired)).toString("base64url");
    let offset = 0;
    await page.context().addCookies(
      sessionCookies.map((c, i) => {
        const length =
          i === sessionCookies.length - 1
            ? expiredValue.length - offset
            : c.value.length;
        const value = expiredValue.slice(offset, offset + length);
        offset += length;
        return { ...c, value };
      }),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your monitoring workspace" }),
    ).toBeVisible();
    const refreshed = (await page.context().cookies())
      .filter((c) => /auth-token(?:\.\d+)?$/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => c.value)
      .join("");
    const freshSession = JSON.parse(
      Buffer.from(refreshed.slice(7), "base64url").toString(),
    );
    expect(freshSession.expires_at).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
    await page.goto("/settings");
    await expect(
      page.locator(".sidebar").getByRole("link", { name: /^Settings/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.locator(".sidebar").getByRole("link", { name: /^Overview/ }),
    ).not.toHaveAttribute("aria-current", "page");
    await page.goto("/dashboard");
    await page.getByLabel("Client name").fill("Zeta Agency");
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByText("Client added.")).toBeVisible();
    await page.getByLabel("Client name").fill("Acme Studio");
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(
      page.getByRole("link", { name: "View clients", exact: true }),
    ).toHaveText("2");

    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "Clients", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Clients", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name: "Clients", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Zeta Agency", exact: true }).click();
    await expect(
      page.getByText("No monitors for this client yet."),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Create monitor for this client" })
      .click();
    await expect(page.getByLabel("Client", { exact: true })).toHaveValue(
      await db`select id from watchdog.clients where workspace_id=${workspace} and name='Zeta Agency'`.then(
        (rows) => rows[0].id,
      ),
    );

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
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "Clients", exact: true })
      .click();
    await page.getByRole("link", { name: "Zeta Agency", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Daily lead sync", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Daily lead sync", exact: true })
      .click();

    await expect(
      page.getByText("synthetic-test:passed", { exact: true }),
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
    await page.getByRole("link", { name: /^Settings/ }).click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
  } finally {
    await db`delete from watchdog.workspaces where id=${workspace}`;
    await db.end();
    await admin.auth.admin.deleteUser(data.user!.id);
  }
});
