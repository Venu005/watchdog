export async function resolveWorkspace(
  verify: () => Promise<{ id: string } | null>,
  lookup: (id: string) => Promise<{ id: string } | null>,
) {
  const user = await verify();
  if (!user) throw new Error("Sign in required");
  const workspace = await lookup(user.id);
  if (!workspace) throw new Error("Workspace not provisioned");
  return { userId: user.id, workspaceId: workspace.id };
}
