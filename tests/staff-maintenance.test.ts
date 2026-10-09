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
  maintenanceTarget,
  qaCleanupState,
  qaCleanupPlan,
  purgeDisposableStaff,
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

describe("explicit QA audit purge", () => {
  beforeEach(async () => {
    await db.exec(
      'ALTER TABLE "AuditEvent" DISABLE TRIGGER immutable_audit; DELETE FROM "AuditEvent"; ALTER TABLE "AuditEvent" ENABLE TRIGGER immutable_audit; DELETE FROM "DevelopmentAuditActor";',
    );
    await query(
      "INSERT INTO \"DevelopmentAuditActor\" (id) VALUES ('qa'),('browser'),('former-qa')",
    );
    await query(
      "INSERT INTO \"StaffUser\" (id,email,name,role,suspended,\"passwordHash\") VALUES ('ordinary','ordinary@synthetic.invalid','Ordinary staff','MODERATOR',true,$1)",
      [oldHash],
    );
    const throttle = `login:${createHash("sha256").update("qa-temp@synthetic.invalid").digest("hex")}`;
    await query('INSERT INTO "AuthThrottle" (key,count) VALUES ($1,4)', [
      throttle,
    ]);
    for (const [id, actorId, entityType, entityId, action, changes, source] of [
      ["real-event", "admin", "MEMBER", "member", "MEMBER_UPDATE", {}, "WEB"],
      ["qa-event", "qa", "MEMBER", "member", "MEMBER_UPDATE", {}, "WEB"],
      ["qa-login", null, "SECURITY", "qa", "AUTH_LOGIN", {}, "AUTH"],
      [
        "qa-target",
        "admin",
        "STAFF",
        "qa",
        "STAFF_PERMISSION_CHANGE",
        {},
        "WEB",
      ],
      [
        "qa-group",
        null,
        "STAFF",
        "synthetic-qa",
        "QA_ACCOUNT_PROVISION",
        { accountIds: ["qa", "browser"] },
        "TEST",
      ],
      ["former-event", "former-qa", "PAGE", "members", "STAFF_VIEW", {}, "WEB"],
      [
        "mixed-event",
        null,
        "STAFF",
        "bulk",
        "STAFF_PASSWORD_CHANGE",
        { accountIds: ["qa", "admin"] },
        "CLI",
      ],
      [
        "mixed-qa-event",
        "qa",
        "STAFF",
        "bulk",
        "STAFF_PASSWORD_CHANGE",
        { accountIds: ["qa", "admin"] },
        "WEB",
      ],
      ["system-event", null, "SYSTEM", "system", "SYSTEM_CHECK", {}, "CLI"],
      [
        "unrelated-test",
        "ordinary",
        "PAGE",
        "members",
        "STAFF_VIEW",
        {},
        "TEST",
      ],
    ]) {
      await query(
        'INSERT INTO "AuditEvent" (id,"actorId","actorRole",action,"entityType","entityId",changes,"correlationId",source) VALUES ($1,$2,\'SYSTEM\',$3,$4,$5,$6::jsonb,$1,$7)',
        [
          id,
          actorId,
          action,
          entityType,
          entityId,
          JSON.stringify(changes),
          source,
        ],
      );
    }
  });

  it("selects QA-only history, including formerly deleted QA identities, and retains real and mixed history", async () => {
    const plan = qaCleanupPlan(await qaCleanupState(query));
    expect(plan.counts).toEqual({
      staff: 2,
      sessions: 2,
      throttles: 1,
      audit: 5,
      markers: 2,
      mixedAuditRetained: 2,
    });
    expect(plan.auditIds.sort()).toEqual([
      "former-event",
      "qa-event",
      "qa-group",
      "qa-login",
      "qa-target",
    ]);
    expect(plan.markerIds.sort()).toEqual(["browser", "former-qa"]);
  });

  it("backs up first, purges selected rows together, preserves other records and restores audit protection", async () => {
    let saved = false;
    const result = await purgeDisposableStaff(
      query,
      "development",
      async (backup) => {
        expect(backup.tables.StaffUser).toHaveLength(5);
        expect(backup.tables.AuditEvent).toHaveLength(10);
        expect((await query('SELECT id FROM "StaffUser"')).rows).toHaveLength(
          5,
        );
        saved = true;
      },
    );
    expect(saved).toBe(true);
    expect(result.after).toEqual({
      StaffUser: 3,
      StaffSession: 2,
      AuthThrottle: 0,
      AuditEvent: 6,
      DevelopmentAuditActor: 1,
    });
    expect(
      (await query('SELECT id FROM "StaffUser" ORDER BY id')).rows,
    ).toEqual([{ id: "admin" }, { id: "mod" }, { id: "ordinary" }]);
    expect(
      (
        await query(
          "SELECT action,changes FROM \"AuditEvent\" WHERE action='STAFF_QA_CLEANUP'",
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      query("DELETE FROM \"AuditEvent\" WHERE id='real-event'"),
    ).rejects.toThrow("append-only");
  });

  it("aborts before mutations if backup writing fails", async () => {
    const before = await qaCleanupState(query);
    await expect(
      purgeDisposableStaff(query, "development", async () => {
        throw new Error("backup unavailable");
      }),
    ).rejects.toThrow("backup unavailable");
    expect(await qaCleanupState(query)).toEqual(before);
    await expect(query('DELETE FROM "AuditEvent"')).rejects.toThrow(
      "append-only",
    );
  });

  it("rolls back accounts and audit protection if deleting selected history fails", async () => {
    const before = await qaCleanupState(query);
    const failingQuery: Query = (sql, parameters) => {
      if (sql.startsWith('DELETE FROM "AuditEvent"'))
        throw new Error("simulated deletion failure");
      return query(sql, parameters);
    };
    await expect(
      purgeDisposableStaff(failingQuery, "development", async () => {}),
    ).rejects.toThrow("simulated deletion failure");
    expect(await qaCleanupState(query)).toEqual(before);
    await expect(query('DELETE FROM "AuditEvent"')).rejects.toThrow(
      "append-only",
    );
  });

  it("rejects the wrong environment before backup or mutations", async () => {
    let saved = false;
    await expect(
      purgeDisposableStaff(query, "preview", async () => {
        saved = true;
      }),
    ).rejects.toThrow("selected environment");
    expect(saved).toBe(false);
    expect((await query('SELECT id FROM "StaffUser"')).rows).toHaveLength(5);
  });

  it("makes a second purge a no-op while retaining mixed history and the cleanup receipt", async () => {
    await purgeDisposableStaff(query, "development", async () => {});
    const before = await qaCleanupState(query);
    let saved = false;
    const result = await purgeDisposableStaff(
      query,
      "development",
      async () => {
        saved = true;
      },
    );
    expect(result.changed).toBe(false);
    expect(saved).toBe(false);
    expect(result.counts.staff).toBe(0);
    expect(result.counts.audit).toBe(0);
    expect(await qaCleanupState(query)).toEqual(before);
  });

  it("preserves an active QA account even if it has a historical identity marker", async () => {
    await query("UPDATE \"StaffUser\" SET suspended=false WHERE id='qa'");
    await query(
      "INSERT INTO \"AuditEvent\" (id,\"actorRole\",action,\"entityType\",\"entityId\",changes,\"correlationId\",source) VALUES ('active-qa-provision','SYSTEM','QA_ACCOUNT_PROVISION','STAFF','synthetic-qa','{\"accountIds\":[\"qa\"]}','active-qa-provision','TEST')",
    );
    const plan = qaCleanupPlan(await qaCleanupState(query));
    expect(plan.accountIds).toEqual(["browser"]);
    expect(plan.auditIds).not.toContain("qa-event");
    expect(plan.auditIds).not.toContain("qa-login");
    expect(plan.auditIds).not.toContain("active-qa-provision");
  });
});

describe("maintenance environment targets", () => {
  it("uses separate credential files and tiers for local, test and production", () => {
    expect(maintenanceTarget(["--local"]).tier).toBe("development");
    expect(maintenanceTarget(["--test"])).toMatchObject({
      tier: "preview",
      file: ".local/test-transfer/target.env",
    });
    expect(maintenanceTarget(["--production"])).toMatchObject({
      tier: "production",
      file: ".local/neon-transfer/target.env",
    });
    expect(maintenanceTarget(["--neon"])).toEqual(
      maintenanceTarget(["--production"]),
    );
    expect(() => maintenanceTarget(["--local", "--production"])).toThrow(
      "exactly one",
    );
    expect(() => maintenanceTarget([])).toThrow("exactly one");
  });
});
