import { readFile } from "node:fs/promises";
import { encryptSecret } from "../src/server/secrets";
import { getDb, closeDb } from "../src/server/db";
const [workspaceId, file] = process.argv.slice(2);
if (!workspaceId || !file)
  throw new Error(
    "Usage: pnpm configure-google WORKSPACE_ID /path/to/service-account.json",
  );
try {
  const value = JSON.parse(await readFile(file, "utf8"));
  if (
    value.type !== "service_account" ||
    !value.client_email ||
    !value.private_key
  )
    throw new Error("A service account is required");
  const sealed = encryptSecret(
    JSON.stringify({
      client_email: value.client_email,
      private_key: value.private_key,
    }),
    process.env.CREDENTIAL_ENCRYPTION_KEY ?? "",
  );
  const rows =
    await getDb()`update watchdog.workspaces set credentials=${sealed} where id=${workspaceId} returning id`;
  if (!rows.length) throw new Error("Workspace not found");
  console.log(
    "Read-only Google credentials stored encrypted. Sheet permissions still require verification.",
  );
} finally {
  await closeDb();
}
