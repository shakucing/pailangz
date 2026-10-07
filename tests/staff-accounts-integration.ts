import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Actor } from "../src/lib/db";
import {
  staffCreate,
  staffEdit,
  staffRemove,
  staffCreateSchema,
} from "../src/lib/staff-accounts";
import { privateTx, audit } from "../src/lib/db";
import { compare } from "bcryptjs";

export async function runStaffAccountIntegration(
  owner: pg.Client,
  actor: Actor,
  mod: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const password = "synthetic integration password 2026";
  let createdId = "";
  await check(
    "admin creates moderator in-app without a reason; audit excludes credentials",
    async () => {
      const result = await staffCreate(actor, {
        name: "New moderator",
        email: "  NEW-MOD@synthetic.invalid ",
        password,
        role: "MODERATOR",
      });
      createdId = result.id;
      const row = (
        await owner.query(
          'SELECT email,role,"passwordHash" FROM "StaffUser" WHERE id=$1',
          [createdId],
        )
      ).rows[0];
      assert.equal(row.email, "new-mod@synthetic.invalid");
      assert.equal(row.role, "MODERATOR");
      assert.ok(await compare(password, row.passwordHash));
      const logs = (
        await owner.query(
          'SELECT changes,reason FROM "AuditEvent" WHERE "entityId"=$1 AND action=\'STAFF_CREATE\'',
          [createdId],
        )
      ).rows;
      assert.equal(logs.length, 1);
      assert.equal(logs[0].reason, null);
      assert.ok(!JSON.stringify(logs).includes(password));
      assert.ok(!JSON.stringify(logs).includes(row.passwordHash));
    },
  );
  await check(
    "short and bcrypt-truncated passwords and duplicate emails are rejected",
    async () => {
      assert.equal(
        staffCreateSchema.safeParse({
          name: "Test",
          email: "other@synthetic.invalid",
          password: "short",
          role: "MODERATOR",
        }).success,
        false,
      );
      assert.equal(
        staffCreateSchema.safeParse({
          name: "Test",
          email: "other@synthetic.invalid",
          password: "😀".repeat(20),
          role: "MODERATOR",
        }).success,
        false,
      );
      await assert.rejects(
        staffCreate(actor, {
          name: "Duplicate",
          email: "new-mod@synthetic.invalid",
          password,
          role: "MODERATOR",
        }),
        (e: unknown) => (e as { status?: number }).status === 409,
      );
    },
  );
  await check(
    "moderator and forged role cannot call staff creation, edits or deletion",
    async () => {
      await assert.rejects(
        staffCreate(mod, {
          name: "Denied",
          email: "denied@synthetic.invalid",
          password,
          role: "ADMIN",
        }),
      );
      await assert.rejects(
        staffEdit(mod, { id: createdId, role: "ADMIN", suspended: false }),
      );
      await assert.rejects(staffRemove(mod, { id: createdId }));
      await assert.rejects(
        staffCreate(
          { ...mod, role: "ADMIN" },
          {
            name: "Denied",
            email: "forged@synthetic.invalid",
            password,
            role: "ADMIN",
          },
        ),
      );
      assert.equal(
        (
          await owner.query(
            "SELECT count(*)::int n FROM \"StaffUser\" WHERE email LIKE '%denied%' OR email LIKE '%forged%'",
          )
        ).rows[0].n,
        0,
      );
    },
  );
  const sid = randomUUID();
  await owner.query(
    'INSERT INTO "StaffSession" (id,"userId","expiresAt") VALUES($1,$2,now()+interval \'1 hour\')',
    [sid, createdId],
  );
  await check(
    "admin edits identity and permissions without a reason and revokes sessions",
    async () => {
      await staffEdit(actor, {
        id: createdId,
        name: "Updated moderator",
        email: "edited@synthetic.invalid",
        role: "MODERATOR",
        suspended: true,
      });
      const row = (
        await owner.query(
          'SELECT name,email,suspended,"sessionVersion" FROM "StaffUser" WHERE id=$1',
          [createdId],
        )
      ).rows[0];
      assert.equal(row.name, "Updated moderator");
      assert.equal(row.email, "edited@synthetic.invalid");
      assert.equal(row.suspended, true);
      assert.equal(row.sessionVersion, 2);
      assert.equal(
        (
          await owner.query('SELECT revoked FROM "StaffSession" WHERE id=$1', [
            sid,
          ])
        ).rows[0].revoked,
        true,
      );
      await assert.rejects(
        privateTx(
          {
            id: createdId,
            role: "MODERATOR",
            sessionId: sid,
            authenticatedAt: new Date(),
          },
          (tx) => tx.member.findMany(),
        ),
      );
      await assert.rejects(
        staffEdit(actor, { id: actor.id, role: "MODERATOR", suspended: true }),
      );
    },
  );
  await check(
    "staff account deletion preserves history and protects the current admin",
    async () => {
      await assert.rejects(staffRemove(actor, { id: actor.id }));
      await staffRemove(actor, { id: createdId });
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "StaffUser" WHERE id=$1',
            [createdId],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "StaffSession" WHERE "userId"=$1',
            [createdId],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "AuditEvent" WHERE "entityId"=$1',
            [createdId],
          )
        ).rows[0].n,
        3,
      );
    },
  );
  await check(
    "staff account mutations roll back when their audit write fails",
    async () => {
      const id = randomUUID();
      await assert.rejects(
        privateTx(actor, async (tx) => {
          await tx.$executeRaw`SELECT app_create_staff(${id},${"rollback@synthetic.invalid"},${"Rollback"},${"$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},${"MODERATOR"}::"StaffRole")`;
          await audit(
            tx,
            { ...actor, id: mod.id },
            "STAFF_CREATE",
            "STAFF",
            id,
          );
        }),
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "StaffUser" WHERE id=$1',
            [id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await check(
    "RLS checks are statement-scoped without granting direct staff writes",
    async () => {
      const policies = (
        await owner.query(
          "SELECT qual FROM pg_policies WHERE schemaname='public' AND policyname='staff_read' AND tablename='Member'",
        )
      ).rows;
      assert.match(policies[0].qual, /SELECT app_staff_allowed/);
      assert.equal(
        (
          await owner.query(
            "SELECT has_table_privilege('pailangz_app','\"StaffUser\"','INSERT,UPDATE,DELETE') allowed",
          )
        ).rows[0].allowed,
        false,
      );
      await assert.rejects(
        privateTx(
          mod,
          (tx) => tx.$executeRaw`SELECT app_remove_staff(${actor.id})`,
        ),
      );
    },
  );
}
