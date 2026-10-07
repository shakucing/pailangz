import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
if (!stdin.isTTY)
  throw new Error(
    "Staff provisioning requires an interactive terminal; never pass passwords in command-line arguments.",
  );
const rl = createInterface({ input: stdin, output: stdout });
const email = z
  .email()
  .parse((await rl.question("Staff email: ")).trim().toLowerCase());
const name = z
  .string()
  .min(1)
  .parse(await rl.question("Display name: "));
const role = z
  .enum(["ADMIN", "MODERATOR"])
  .parse((await rl.question("Role (ADMIN / MODERATOR): ")).trim());
rl.close();
stdout.write("Password (minimum 14 characters, input hidden): ");
stdin.setRawMode(true);
stdin.resume();
const password = await new Promise<string>((resolve, reject) => {
  let value = "";
  function data(chunk: Buffer) {
    for (const char of chunk.toString()) {
      if (char === "\u0003") {
        stdin.off("data", data);
        reject(new Error("Cancelled"));
        return;
      }
      if (char === "\r" || char === "\n") {
        stdin.off("data", data);
        resolve(value);
        return;
      }
      if (char === "\u007f") {
        value = value.slice(0, -1);
      } else value += char;
    }
  }
  stdin.on("data", data);
});
stdin.setRawMode(false);
stdin.pause();
stdout.write("\n");
z.string()
  .min(14)
  .max(200)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must fit within bcrypt's 72-byte limit.",
  )
  .parse(password);
process.env.DATABASE_URL =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const { db, audit } = await import("../src/lib/db");
const id = randomUUID();
await db.$transaction(async (tx) => {
  await tx.staffUser.create({
    data: {
      id,
      email,
      name,
      role,
      passwordHash: await hash(password, 12),
    },
  });
  await audit(
    tx,
    null,
    "STAFF_PROVISION",
    "STAFF",
    id,
    { role, authenticationMethod: "password" },
    "Operator provisioned staff via local owner connection.",
    { source: "CLI" },
  );
});
await db.$disconnect();
console.log(
  "Staff account provisioned. Sign in with the email and password you provided.",
);
