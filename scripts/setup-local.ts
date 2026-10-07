import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
await mkdir(".local", { recursive: true, mode: 0o700 });
try {
  await readFile(".env");
} catch {
  const key = randomBytes(32).toString("base64");
  await writeFile(
    ".env",
    `APP_ENV=development\nDATABASE_ENV=development\nLOCAL_PGLITE=true\nDATABASE_URL=postgresql://postgres@127.0.0.1:5548/postgres?sslmode=disable\nMIGRATION_DATABASE_URL=postgresql://postgres@127.0.0.1:5548/postgres?sslmode=disable\nNEXTAUTH_URL=http://localhost:3000\nNEXTAUTH_SECRET=${randomBytes(48).toString("base64url")}\nDATA_ENCRYPTION_KEYS=${JSON.stringify({ v1: key })}\nACTIVE_ENCRYPTION_KEY=v1\nPHONE_DEFAULT_COUNTRY=MY\nEVIDENCE_STORAGE=local\nPRIVATE_EXPORT_ENABLED=false\n`,
    { mode: 0o600, flag: "wx" },
  );
}
const pg = await PGlite.create(".local/postgres");
await pg.exec(
  "CREATE TABLE IF NOT EXISTS local_migrations (name text PRIMARY KEY,checksum text NOT NULL)",
);
for (const name of (await readdir("prisma/migrations"))
  .sort()
  .filter((n) => /^\d/.test(n))) {
  const sql = await readFile(`prisma/migrations/${name}/migration.sql`, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const previous = await pg.query<{ checksum: string }>(
    "SELECT checksum FROM local_migrations WHERE name=$1",
    [name],
  );
  if (previous.rows.length) {
    if (previous.rows[0].checksum !== checksum)
      throw new Error(
        "An applied migration changed. Use a fresh synthetic local database.",
      );
    continue;
  }
  await pg.transaction(async (tx) => {
    await tx.exec(sql);
    await tx.query("INSERT INTO local_migrations VALUES ($1,$2)", [
      name,
      checksum,
    ]);
  });
}
await pg.close();
console.log(
  "Persistent synthetic development database initialized. Start pnpm db:local, then pnpm db:seed. Secrets are only in the ignored .env.",
);
