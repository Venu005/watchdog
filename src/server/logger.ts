import pino, { type Logger as PinoLogger } from "pino";

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogContext = Record<string, unknown>;

const sensitiveKey =
  /(?:authorization|cookie|password|passwd|token|secret|credential|api[_-]?key|database(?:[_-]?url)?|connection(?:[_-]?string)?|email)/i;
const urlCredentials = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const bearerValue = /(bearer\s+)[^\s]+/gi;
const databaseUrl =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/gi;
const emailAddress = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g;

function defaultLevels(environment: string | undefined): LogLevel[] {
  return environment === "production"
    ? ["info", "warn", "error", "fatal"]
    : ["debug", "info", "warn", "error", "fatal"];
}

export function parseLogLevels(
  value = process.env.LOG_LEVEL,
  environment: string | undefined = process.env.NODE_ENV,
): Set<LogLevel> {
  const values = (value ?? defaultLevels(environment).join(","))
    .split(",")
    .map((level) => level.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length)
    throw new Error(
      "LOG_LEVEL must contain at least one comma-separated level",
    );
  const invalid = values.filter(
    (level): level is string => !LOG_LEVELS.includes(level as LogLevel),
  );
  if (invalid.length)
    throw new Error(
      `Invalid LOG_LEVEL value(s): ${invalid.join(", ")}. Allowed values: ${LOG_LEVELS.join(", ")}.`,
    );
  return new Set(values as LogLevel[]);
}

export function redactText(value: string) {
  return value
    .replace(databaseUrl, "[REDACTED]")
    .replace(urlCredentials, "$1[REDACTED]@")
    .replace(bearerValue, "$1[REDACTED]")
    .replace(emailAddress, "[REDACTED]");
}

export function redactLogValue(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value).slice(0, 4096);
  if (Array.isArray(value))
    return value.map((item) => redactLogValue(item, key));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        redactLogValue(item, name),
      ]),
    );
  return value;
}

export function serializeError(error: unknown) {
  if (error instanceof Error)
    return {
      type: error.name,
      message: redactText(error.message),
      stack: error.stack ? redactText(error.stack) : undefined,
    };
  return { type: "UnknownError", message: redactText(String(error)) };
}

export type AppLogger = {
  child(context: LogContext): AppLogger;
  trace(event: string, context?: LogContext): void;
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, error: unknown, context?: LogContext): void;
  fatal(event: string, error: unknown, context?: LogContext): void;
};

function wrap(instance: PinoLogger, enabled: Set<LogLevel>): AppLogger {
  const emit = (level: LogLevel, event: string, context: LogContext = {}) => {
    if (!enabled.has(level)) return;
    instance[level]({ ...(redactLogValue(context) as LogContext), event });
  };
  const error = (
    level: "error" | "fatal",
    event: string,
    cause: unknown,
    context: LogContext = {},
  ) => emit(level, event, { ...context, error: serializeError(cause) });
  return {
    child(context) {
      return wrap(
        instance.child(redactLogValue(context) as LogContext),
        enabled,
      );
    },
    trace: (event, context) => emit("trace", event, context),
    debug: (event, context) => emit("debug", event, context),
    info: (event, context) => emit("info", event, context),
    warn: (event, context) => emit("warn", event, context),
    error: (event, cause, context) => error("error", event, cause, context),
    fatal: (event, cause, context) => error("fatal", event, cause, context),
  };
}

export function createLogger(
  component: "web" | "worker" | "script",
  levels = parseLogLevels(),
) {
  const instance = pino({
    base: { service: "watchdog", component },
    level: "trace",
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "password",
        "token",
        "secret",
        "authorization",
        "cookie",
        "credentials",
      ],
      censor: "[REDACTED]",
    },
  });
  return wrap(instance, levels);
}

export const logger = createLogger("web");
export const workerLogger = createLogger("worker");
