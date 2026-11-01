import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function decodeKey(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("Encryption key must be 32 bytes encoded as hex");
  return Buffer.from(key, "hex");
}
export function encryptSecret(value: string, key: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", decodeKey(key), iv);
  const encrypted = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptSecret(value: string, key: string) {
  const [version, iv, tag, data, ...rest] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || rest.length)
    throw new Error("Invalid encrypted credential");
  const d = createDecipheriv(
    "aes-256-gcm",
    decodeKey(key),
    Buffer.from(iv, "base64url"),
  );
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    d.update(Buffer.from(data, "base64url")),
    d.final(),
  ]).toString("utf8");
}
