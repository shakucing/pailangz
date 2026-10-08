import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { migrations } from "../scripts/neon-transfer";

let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create();
  for (const migration of await migrations()) {
    if (migration.name.endsWith("production_activity")) break;
    await db.exec(
      await readFile(
        `prisma/migrations/${migration.name}/migration.sql`,
        "utf8",
      ),
    );
  }
  await db.exec(`
    INSERT INTO "StaffUser" (id,email,name,role,"passwordHash") VALUES
    ('admin','admin@example.invalid','Real admin','ADMIN','hash'),
    ('qa','qa@synthetic.invalid','Disposable synthetic QA operator','ADMIN','hash'),
    ('ordinary','ordinary@synthetic.invalid','Ordinary staff','MODERATOR','hash');
    INSERT INTO "StaffSession" (id,"userId","expiresAt") VALUES ('session','admin','2099-01-01');
  `);
  const rows = [
    ["real", "admin", "MEMBER_UPDATE", "MEMBER", "member", "WEB", {}],
    ["system", null, "REAL_MIGRATION", "SETTING", "real", "MIGRATION", {}],
    ["qa-change", "qa", "MEMBER_UPDATE", "MEMBER", "member", "WEB", {}],
    ["qa-auth", null, "AUTH_LOGIN", "SECURITY", "qa", "AUTH", {}],
    ["test-source", "admin", "STAFF_VIEW", "PAGE", "overview", "TEST", {}],
    [
      "synthetic-flag",
      null,
      "SYNTHETIC_OPERATION",
      "STAFF",
      "bulk",
      "CLI",
      { synthetic: true },
    ],
    [
      "provision",
      null,
      "QA_ACCOUNT_PROVISION",
      "STAFF",
      "synthetic-qa",
      "TEST",
      { accountIds: ["deleted-qa"] },
    ],
    [
      "deleted-qa-action",
      "deleted-qa",
      "STAFF_VIEW",
      "PAGE",
      "members",
      "WEB",
      {},
    ],
    [
      "ordinary-staff",
      "ordinary",
      "MEMBER_UPDATE",
      "MEMBER",
      "member",
      "WEB",
      {},
    ],
    ["qa-target", "admin", "STAFF_PERMISSION_CHANGE", "STAFF", "qa", "WEB", {}],
    [
      "mixed-maintenance",
      null,
      "STAFF_PASSWORD_CHANGE",
      "STAFF",
      "bulk",
      "CLI",
      { accountIds: ["admin", "qa"] },
    ],
  ];
  for (const [
    id,
    actorId,
    action,
    entityType,
    entityId,
    source,
    changes,
  ] of rows)
    await db.query(
      'INSERT INTO "AuditEvent" (id,"actorId","actorRole",action,"entityType","entityId",source,changes,"correlationId") VALUES ($1,$2,\'ADMIN\',$3,$4,$5,$6,$7::jsonb,$1)',
      [
        id,
        actorId,
        action,
        entityType,
        entityId,
        source,
        JSON.stringify(changes),
      ],
    );
  await db.exec(
    await readFile(
      "prisma/migrations/202610080022_production_activity/migration.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "prisma/migrations/202610080023_preserve_real_activity/migration.sql",
      "utf8",
    ),
  );
  // Verified identity survives deletion of the original staff account.
  await db.exec("DELETE FROM \"StaffUser\" WHERE id='qa'");
}, 30_000);
afterAll(async () => {
  await db.close();
});

async function visible(tier: string) {
  await db.query('UPDATE "DeploymentEnvironment" SET tier=$1', [tier]);
  return db.transaction(async (tx) => {
    await tx.exec(
      "SET LOCAL ROLE pailangz_app; SELECT set_config('app.actor_id','admin',true),set_config('app.session_id','session',true)",
    );
    return (
      await tx.query<{ id: string }>(
        "SELECT id FROM \"AuditEvent\" WHERE action<>'STAFF_AUTHENTICATION_POLICY_CHANGE' ORDER BY id",
      )
    ).rows.map((row) => row.id);
  });
}
describe("production activity history", () => {
  it("excludes verified QA identities, provisioning, sign-ins and explicit test events while retaining real and system activity", async () => {
    expect(await visible("production")).toEqual([
      "mixed-maintenance",
      "ordinary-staff",
      "real",
      "system",
    ]);
    expect(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int n FROM \"AuditEvent\" WHERE action<>'STAFF_AUTHENTICATION_POLICY_CHANGE'",
        )
      ).rows[0].n,
    ).toBe(11);
  });
  it("leaves development activity visible and audit immutability enforced", async () => {
    expect(await visible("development")).toHaveLength(11);
    await expect(
      db.exec("DELETE FROM \"AuditEvent\" WHERE id='qa-change'"),
    ).rejects.toThrow("append-only");
  });
});
