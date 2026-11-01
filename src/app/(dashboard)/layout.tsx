import Link from "next/link";
import { SidebarNav } from "../../components/sidebar-nav";
import { redirect } from "next/navigation";
import { workspaceForPage as requireWorkspace } from "../../server/auth";
import { signoutAction } from "../../server/actions";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireWorkspace();
  } catch {
    redirect("/login");
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="brand-mark">w</span>watchdog
          <span className="brand-dot">.</span>
        </Link>
        <span className="sidebar-label">AGENCY WORKSPACE</span>
        <SidebarNav />
        <div className="sidebar-bottom">
          <p className="small">
            A second pair of eyes
            <br />
            <span className="muted">for your automations.</span>
          </p>
          <form action={signoutAction}>
            <button className="text-button">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="muted">Automation monitoring</span>
          <span className="environment">
            {process.env.NODE_ENV === "production"
              ? "Pilot workspace"
              : "Local development"}
          </span>
        </header>
        <main className="content">{children}</main>
        <footer>
          Automation Watchdog{" "}
          <span>All times in UTC · Evidence, not assumptions.</span>
        </footer>
      </div>
    </div>
  );
}
