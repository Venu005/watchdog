"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
const items = [
  { href: "/dashboard", label: "Overview", icon: "↗" },
  { href: "/clients", label: "Clients", icon: "↗" },
  { href: "/monitors/new", label: "New monitor", icon: "+" },
  { href: "/settings", label: "Settings", icon: "↗" },
];
export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace navigation">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href === "/clients" && pathname.startsWith("/clients/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
            <span aria-hidden="true">{item.icon}</span>
          </Link>
        );
      })}
    </nav>
  );
}
