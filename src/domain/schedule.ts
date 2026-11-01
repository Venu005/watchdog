export type Schedule = {
  kind: "hourly" | "daily" | "weekdays";
  hour: number;
  minute: number;
  graceMinutes: number;
};
export function validateSchedule(s: Schedule) {
  if (
    !["hourly", "daily", "weekdays"].includes(s.kind) ||
    !Number.isInteger(s.hour) ||
    s.hour < 0 ||
    s.hour > 23 ||
    !Number.isInteger(s.minute) ||
    s.minute < 0 ||
    s.minute > 59
  )
    throw new Error("Invalid UTC schedule");
  if (
    !Number.isInteger(s.graceMinutes) ||
    s.graceMinutes < 1 ||
    s.graceMinutes >= (s.kind === "hourly" ? 60 : 1440)
  )
    throw new Error("Invalid grace period");
  return s;
}
export function nextOccurrence(s: Schedule, after: Date): Date {
  validateSchedule(s);
  if (!Number.isFinite(after.getTime())) throw new Error("Invalid time");
  const d = new Date(after);
  d.setUTCSeconds(0, 0);
  if (s.kind === "hourly") {
    d.setUTCMinutes(s.minute);
    if (d <= after) d.setUTCHours(d.getUTCHours() + 1);
  } else {
    d.setUTCHours(s.hour, s.minute, 0, 0);
    if (d <= after) d.setUTCDate(d.getUTCDate() + 1);
    while (s.kind === "weekdays" && [0, 6].includes(d.getUTCDay()))
      d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}
export function getWindow(s: Schedule, start: Date) {
  const actual = nextOccurrence(s, new Date(start.getTime() - 1));
  if (actual.getTime() !== start.getTime())
    throw new Error("Not a scheduled occurrence");
  return {
    start,
    end: nextOccurrence(s, start),
    deadline: new Date(start.getTime() + s.graceMinutes * 60000),
  };
}
export function latestOccurrence(s: Schedule, at: Date) {
  const lookback = s.kind === "hourly" ? 3600000 : 4 * 86400000;
  let d = nextOccurrence(s, new Date(at.getTime() - lookback));
  while (true) {
    const n = nextOccurrence(s, d);
    if (n > at) return d;
    d = n;
  }
}
