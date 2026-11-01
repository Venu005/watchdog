export const statusLabels: Record<string, string> = {
  healthy: "Healthy",
  failing: "Needs attention",
  awaiting: "Awaiting first run",
  paused: "Paused",
};
export function Status({ value }: { value: string }) {
  return (
    <span className={"status " + value}>
      <span className="dot" />
      {statusLabels[value] ?? value}
    </span>
  );
}
export function Time({ value }: { value: Date | string | null | undefined }) {
  return (
    <span>
      {value
        ? new Date(value)
            .toISOString()
            .replace("T", " ")
            .replace(/\.\d{3}Z$/, " UTC")
        : "—"}
    </span>
  );
}
