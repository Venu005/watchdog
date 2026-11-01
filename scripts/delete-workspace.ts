import { createClient } from "@supabase/supabase-js";
import { deleteWorkspace } from "../src/server/operations";
import { closeDb } from "../src/server/db";
const [id, confirm] = process.argv.slice(2);
if (!id || confirm !== "--confirm")
  throw new Error(
    "Usage: pnpm delete-workspace WORKSPACE_ID --confirm. Permanently removes workspace data.",
  );
try {
  const ownerId = await deleteWorkspace(id);
  if (ownerId) {
    const auth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { error } = await auth.auth.admin.deleteUser(ownerId);
    if (error) {
      console.error(
        "Workspace data deleted; auth account cleanup still required.",
      );
      process.exitCode = 1;
    } else console.log("Workspace data and owner authentication deleted.");
  } else console.log("Workspace not found; nothing to delete.");
} finally {
  await closeDb();
}
