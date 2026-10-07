import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { compare, hash } from "bcryptjs";
import { createHash } from "node:crypto";
import { migrations } from "../scripts/neon-transfer";
import {
  disposableQa,
  validateStaffPassword,
  updateStaffPasswords,
  removeDisposableStaff,
  type StaffAccount,
  type Query,
} from "../scripts/staff-maintenance";

let db: PGlite;
let oldHash: string;
let newHash: string;
const query: Query = (sql, parameters) =>
  db.query<Record<string, unknown>>(sql, parameters);
async function account(id: string) {
  return (await query('SELECT * FROM "StaffUser" WHERE id=$1', [id]))
    .rows[0] as StaffAccount;
}
beforeAll(async () => {
  db = await PGlite.create();
  for (const migration of await migrations())
    await db.exec(
      await readFile(
        `prisma/migrations/${migration.name}/migration.sql`,
        "utf8",
      ),
    );
  oldHash = await hash("Old synthetic staff password", 12);
  newHash = await hash("New synthetic staff password", 12);
}, 30_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    'DELETE FROM "StaffSession"; DELETE FROM "StaffUser"; DELETE FROM "AuthThrottle";',
  );
  for (const [id, email, name, role, suspended] of [
    ["admin", "admin@staff.example.invalid", "Real admin", "ADMIN", false],
    [
      "mod",
      "moderator@staff.example.invalid",
      "Real moderator",
      "MODERATOR",
      false,
    ],
    [
      "qa",
      "qa-temp@synthetic.invalid",
      "Disposable synthetic QA operator",
      "ADMIN",
      true,
    ],
    [
      "browser",
      "qa-browser@synthetic.invalid",
      "Disposable browser QA",
      "MODERATOR",
      true,
    ],
  ]) {
    await query(
      'INSERT INTO "StaffUser" (id,email,name,role,suspended,"passwordHash") VALUES ($1,$2,$3,$4::"StaffRole",$5,$6)',
      [id, email, name, role, suspended, oldHash],
    );
    await query(
      'INSERT INTO "StaffSession" (id,"userId","expiresAt") VALUES ($1,$2,\'2099-01-01\')',
      [`session-${id}`, id],
    );
  }
});

describe("operator staff password updates", () => {
  it("changes selected passwords together, revokes their sessions, clears their login throttle and keeps other accounts unchanged", async () => {
    const admin = await account("admin");
    const mod = await account("mod");
    const loginKey = `login:${createHash("sha256").update(admin.email).digest("hex")}`;
    await query('INSERT INTO "AuthThrottle" (key,count) VALUES ($1,10)', [
      loginKey,
    ]);
    await updateStaffPasswords(query, [
      { account: admin, passwordHash: newHash },
      { account: mod, passwordHash: newHash },
    ]);
    for (const id of ["admin", "mod"]) {
      const updated = await account(id);
      expect(
        await compare("New synthetic staff password", updated.passwordHash),
      ).toBe(true);
      expect(updated.sessionVersion).toBe(2);
      expect(
        (
          await query('SELECT revoked FROM "StaffSession" WHERE "userId"=$1', [
            id,
          ])
        ).rows[0].revoked,
      ).toBe(true);
    }
    expect((await account("qa")).passwordHash).toBe(oldHash);
    expect(
      (await query('SELECT * FROM "AuthThrottle" WHERE key=$1', [loginKey]))
        .rows,
    ).toHaveLength(0);
    const events = (
      await query(
        "SELECT changes FROM \"AuditEvent\" WHERE action='STAFF_PASSWORD_CHANGE'",
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(newHash);
    expect(JSON.stringify(events)).not.toContain(
      "New synthetic staff password",
    );
  });

  it("rolls back every password and session update if another account changed during the prompts", async () => {
    const admin = await account("admin");
    const mod = await account("mod");
    await query('UPDATE "StaffUser" SET "sessionVersion"=2 WHERE id=\'mod\'');
    await expect(
      updateStaffPasswords(query, [
        { account: admin, passwordHash: newHash },
        { account: mod, passwordHash: newHash },
      ]),
    ).rejects.toThrow("changed");
    expect((await account("admin")).passwordHash).toBe(oldHash);
    expect(
      (
        await query(
          'SELECT revoked FROM "StaffSession" WHERE "userId"=\'admin\'',
        )
      ).rows[0].revoked,
    ).toBe(false);
  });

  it("refuses suspended accounts and plain text password values", async () => {
    await expect(
      updateStaffPasswords(query, [
        { account: await account("qa"), passwordHash: newHash },
      ]),
    ).rejects.toThrow("not active");
    await expect(
      updateStaffPasswords(query, [
        { account: await account("admin"), passwordHash: "plaintext password" },
      ]),
    ).rejects.toThrow("bcrypt");
    expect((await account("admin")).passwordHash).toBe(oldHash);
  });

  it("validates passwords without silently truncating UTF-8 characters", () => {
    expect(() => validateStaffPassword("short")).toThrow("14");
    expect(() => validateStaffPassword("x".repeat(72))).not.toThrow();
    expect(() => validateStaffPassword("x".repeat(73))).toThrow("72");
    expect(() => validateStaffPassword("界".repeat(25))).toThrow("72");
    expect(() => validateStaffPassword("Long password\nwith newline")).toThrow(
      "line breaks",
    );
  });
});

describe("disposable QA cleanup", () => {
  it("removes only suspended QA staff and their sessions, preserving real staff and existing audit rows", async () => {
    const count = (
      await query('SELECT count(*)::int AS count FROM "AuditEvent"')
    ).rows[0].count as number;
    expect(await removeDisposableStaff(query, ["qa", "browser"])).toBe(2);
    expect(
      (await query('SELECT id FROM "StaffUser" ORDER BY id')).rows,
    ).toEqual([{ id: "admin" }, { id: "mod" }]);
    expect(
      (await query('SELECT "userId" FROM "StaffSession" ORDER BY "userId"'))
        .rows,
    ).toEqual([{ userId: "admin" }, { userId: "mod" }]);
    expect(
      (await query('SELECT count(*)::int AS count FROM "AuditEvent"')).rows[0]
        .count,
    ).toBe(count + 1);
    await expect(query('DELETE FROM "AuditEvent"')).rejects.toThrow(
      "append-only",
    );
  });

  it("refuses a list containing real staff, preserving the last admin and all QA sessions", async () => {
    await expect(removeDisposableStaff(query, ["qa", "admin"])).rejects.toThrow(
      "only removes",
    );
    expect((await query('SELECT id FROM "StaffUser"')).rows).toHaveLength(4);
    expect((await query('SELECT id FROM "StaffSession"')).rows).toHaveLength(4);
  });

  it("refuses QA accounts reactivated after the preview", async () => {
    await query("UPDATE \"StaffUser\" SET suspended=false WHERE id='qa'");
    await expect(removeDisposableStaff(query, ["qa"])).rejects.toThrow(
      "only removes",
    );
  });

  it("requires all three QA markers, excluding suspended real users and active test users", async () => {
    const qa = await account("qa");
    expect(disposableQa(qa)).toBe(true);
    expect(disposableQa({ ...qa, suspended: false })).toBe(false);
    expect(disposableQa({ ...qa, email: "real@example.invalid" })).toBe(false);
    expect(disposableQa({ ...qa, name: "Real operator" })).toBe(false);
  });
});
