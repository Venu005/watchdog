import { describe, it, expect } from "vitest";
import {
  hashToken,
  encryptSecret,
  decryptSecret,
} from "../../src/server/secrets";
describe("secret protection", () => {
  const key = "ab".repeat(32);
  it("roundtrips credentials without storing plaintext", () => {
    const sealed = encryptSecret("private-key", key);
    expect(sealed).not.toContain("private-key");
    expect(decryptSecret(sealed, key)).toBe("private-key");
  });
  it("rejects wrong keys and tampering", () => {
    const sealed = encryptSecret("secret", key);
    expect(() => decryptSecret(sealed, "cd".repeat(32))).toThrow();
    const parts = sealed.split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });
  it("rejects invalid deployment encryption keys", () => {
    expect(() => encryptSecret("secret", "short")).toThrow();
  });
  it("hashes bearer tokens into fixed digests", () => {
    expect(hashToken("token-a")).toHaveLength(64);
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});
