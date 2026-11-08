import { expect, it } from "vitest";
import {
  parseLogLevels,
  redactLogValue,
  redactText,
  serializeError,
} from "../../src/server/logger";

it("uses comma-separated logging levels and trims whitespace", () => {
  expect([...parseLogLevels(" debug, warn ,error ", "production")]).toEqual([
    "debug",
    "warn",
    "error",
  ]);
  expect([...parseLogLevels(undefined, "production")]).toEqual([
    "info",
    "warn",
    "error",
    "fatal",
  ]);
});

it("rejects unknown or empty logging levels", () => {
  expect(() => parseLogLevels("debug,verbose")).toThrow("verbose");
  expect(() => parseLogLevels(" , ")).toThrow("at least one");
});

it("redacts sensitive context recursively", () => {
  expect(
    redactLogValue({
      token: "never-log-this",
      nested: { authorization: "Bearer never-log-this" },
      labels: ["safe", { databaseUrl: "postgres://user:pass@host/db" }],
    }),
  ).toEqual({
    token: "[REDACTED]",
    nested: { authorization: "[REDACTED]" },
    labels: ["safe", { databaseUrl: "[REDACTED]" }],
  });
});

it("redacts credentials from text and serialized errors", () => {
  expect(redactText("postgres://user:pass@example.test/db")).toBe("[REDACTED]");
  expect(redactText("Failure for owner@example.test")).toBe(
    "Failure for [REDACTED]",
  );
  const error = new Error("Bearer top-secret was rejected");
  expect(serializeError(error).message).toBe("Bearer [REDACTED] was rejected");
});
