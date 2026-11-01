import "./globals.css";
export const metadata = {
  title: "Watchdog — Automation monitoring",
  description: "Know when your client automations stop delivering.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
