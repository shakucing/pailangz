import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function keyring(): Record<string, string> {
  const keys = JSON.parse(process.env.DATA_ENCRYPTION_KEYS ?? "{}");
  if (!Object.keys(keys).length)
    throw new Error("Data encryption is not configured.");
  return keys;
}
export function encrypt(value: string, context: string) {
  const version = process.env.ACTIVE_ENCRYPTION_KEY ?? "v1";
  const key = Buffer.from(keyring()[version] ?? "", "base64");
  if (key.length !== 32)
    throw new Error("Invalid encryption key configuration.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    version,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string, context: string) {
  const [version, iv, tag, data] = value.split(".");
  const key = Buffer.from(keyring()[version] ?? "", "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
