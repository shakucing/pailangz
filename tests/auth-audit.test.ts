import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { migrations } from "../scripts/neon-transfer";

let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create();
  for (const migration of await migrations())
    await db.exec(
      await readFile(
        `prisma/migrations/${migration.name}/migration.sql`,
        "utf8",
      ),
    );
}, 30_000);
afterAll(async () => {
  await db.close();
});

const insert =
  "INSERT INTO \"AuditEvent\" (id,\"actorRole\",action,\"entityType\",\"entityId\",changes,\"correlationId\",source) VALUES ($1,'AUTH','AUTH_LOGIN','SECURITY','synthetic-staff','{}',$2,'AUTH')";
describe("authentication audit writes under the restricted runtime role", () => {
  it("reproduces why returning a login audit row fails before staff context exists", async () => {
    await db.exec("BEGIN; SET LOCAL ROLE pailangz_app;");
    try {
      await expect(
        db.query(`${insert} RETURNING id`, [randomUUID(), randomUUID()]),
      ).rejects.toThrow("row-level security");
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("records authentication events without returning rows, while keeping security audit reads private", async () => {
    const id = randomUUID();
    await db.exec("BEGIN; SET LOCAL ROLE pailangz_app;");
    try {
      const write = await db.query(insert, [id, randomUUID()]);
      expect(write.affectedRows).toBe(1);
      expect(
        (await db.query('SELECT id FROM "AuditEvent" WHERE id=$1', [id])).rows,
      ).toEqual([]);
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
    expect(
      (await db.query('SELECT id FROM "AuditEvent" WHERE id=$1', [id])).rows,
    ).toEqual([{ id }]);
  });

  it("continues to deny arbitrary staff audit writes without authentication", async () => {
    await db.exec("BEGIN; SET LOCAL ROLE pailangz_app;");
    try {
      await expect(
        db.query(
          insert.replace(
            "'AUTH','AUTH_LOGIN','SECURITY'",
            "'SYSTEM','STAFF_PASSWORD_CHANGE','STAFF'",
          ),
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow("row-level security");
    } finally {
      await db.exec("ROLLBACK");
    }
  });
});
