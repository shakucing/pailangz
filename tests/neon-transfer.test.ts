import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  captureSnapshot,
  envText,
  migrations,
  neonUrl,
  restoreSnapshot,
  validateSnapshot,
  verifySnapshot,
  type Query,
  type Snapshot,
} from "../scripts/neon-transfer";
import { parse } from "dotenv";

const databases: PGlite[] = [];
const queryFor =
  (db: PGlite): Query =>
  (sql, parameters) =>
    db.query(sql, parameters);
async function migrated() {
  const db = await PGlite.create();
  databases.push(db);
  for (const migration of await migrations())
    await db.exec(
      await readFile(
        `prisma/migrations/${migration.name}/migration.sql`,
        "utf8",
      ),
    );
  return db;
}
let snapshot: Snapshot;

beforeAll(async () => {
  const source = await migrated();
  await source.exec(`
    CREATE TABLE local_migrations (name text PRIMARY KEY,checksum text NOT NULL);
    INSERT INTO "StaffUser" (id,email,name,"passwordHash",role) VALUES ('staff','synthetic@example.invalid','Operator','test-hash','ADMIN');
    INSERT INTO "StaffSession" (id,"userId","expiresAt") VALUES ('session','staff','2030-01-01T00:00:00Z');
    INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ('member-a','Alpha','alpha',true),('member-b','Beta','beta',true);
    INSERT INTO "ImportJob" (id,source,"rowCount") VALUES ('import','CSV',1);
    INSERT INTO "RegistrationSubmission" (id,source,"sourceResponseId","importJobId","payloadEncrypted","originalIgn","displayIgn","canonicalIgn","linkedMemberId")
      VALUES ('submission','CSV','response','import','ciphertext','Alpha','Alpha','alpha','member-a');
    INSERT INTO "MemberPrivate" ("memberId","originalIgn","registrationEncrypted","sourceSubmissionId") VALUES ('member-a','Alpha','ciphertext','submission');
    INSERT INTO "Tournament" (id,slug,name,overview,configuration,"configurationVersion")
      VALUES ('tournament','pailangz-solo-team','Edited tournament','Saved overview','{"soloCapacity":2,"teamCapacity":1}',2);
    INSERT INTO "Category" (id,"tournamentId",kind,capacity) VALUES ('solo','tournament','SOLO',2),('team-category','tournament','TEAM',1);
    INSERT INTO "Stage" (id,"categoryId",key,name,format,"bestOf",rules) VALUES ('stage','solo','league','Saved stage','LEAGUE',3,'{}');
    INSERT INTO "Participant" (id,"tournamentId","memberId",code) VALUES ('player-a','tournament','member-a','P35'),('player-b','tournament','member-b','P65');
    INSERT INTO "Round" (id,"stageId",number,name) VALUES ('round','stage',1,'Saved round');
    INSERT INTO "Match" (id,"roundId","order","sideAId","sideBId","bestOf",status) VALUES ('match','round',1,'player-a','player-b',3,'FINALIZED');
    INSERT INTO "ResultVersion" (id,"matchId",version,outcome,status,"submittedBy",reason,"idempotencyKey") VALUES ('result','match',1,'WIN_A','ACCEPTED','staff','Saved result','saved-result-key');
    INSERT INTO "GameResult" (id,"resultId",number,"scoreA","scoreB") VALUES ('game','result',1,1,0);
    UPDATE "Match" SET "currentResultId"='result' WHERE id='match';
    UPDATE "Stage" SET archived=true WHERE id='stage';
    INSERT INTO "Team" (id,"categoryId",name,code) VALUES ('team','team-category','Saved team','T17');
    INSERT INTO "TeamMembership" (id,"teamId","categoryId","memberId") VALUES ('membership','team','team-category','member-a');
    INSERT INTO "ConfigurationRevision" (id,"tournamentId",version,"beforeConfiguration",configuration,status,"reasonEncrypted","createdBy")
      VALUES ('revision','tournament',2,'{}','{"soloCapacity":2,"teamCapacity":1}','APPLIED','ciphertext','staff');
    INSERT INTO "AuditEvent" (id,"actorRole",action,"entityType","entityId",changes,"correlationId",source)
      VALUES ('audit','SYSTEM','EDIT','TOURNAMENT','tournament','{"saved":true}','correlation','CLI');
    INSERT INTO "IntegrationSetting" (key,value) VALUES ('officialSeedTournament','"tournament"');
  `);
  for (const migration of await migrations())
    await source.query("INSERT INTO local_migrations VALUES ($1,$2)", [
      migration.name,
      migration.checksum,
    ]);
  snapshot = await captureSnapshot(queryFor(source), await migrations());
}, 60000);
afterAll(async () => {
  for (const db of databases) await db.close();
});

describe("Neon copy of the current local database", () => {
  it("preserves cyclic results, archived history, private rows, revisions, staff and team codes", async () => {
    const target = await migrated();
    const query = queryFor(target);
    await restoreSnapshot(query, snapshot);
    await verifySnapshot(query, snapshot);
    const result = await target.query<{ currentResultId: string }>(
      'SELECT "currentResultId" FROM "Match"',
    );
    expect(result.rows[0].currentResultId).toBe("result");
    const team = await target.query<{ code: string }>(
      'SELECT code FROM "Team"',
    );
    expect(team.rows[0].code).toBe("T17");
    const constraints = await target.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_constraint WHERE contype='f' AND condeferrable",
    );
    expect(constraints.rows[0].count).toBe(0);
    const triggers = await target.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'",
    );
    expect(triggers.rows[0].count).toBe(0);
    await expect(
      target.query("UPDATE \"AuditEvent\" SET action='CHANGED'"),
    ).rejects.toThrow("append-only");
    await expect(restoreSnapshot(query, snapshot)).rejects.toThrow(
      "contains data",
    );
    await verifySnapshot(query, snapshot);
  }, 60000);

  it("rolls back every imported row and trigger change when a foreign key fails", async () => {
    const target = await migrated();
    const broken = structuredClone(snapshot);
    broken.tables.MemberPrivate.rows[0].memberId = "missing-member";
    await expect(restoreSnapshot(queryFor(target), broken)).rejects.toThrow(
      "foreign key",
    );
    const rows = await target.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "AuditEvent"',
    );
    expect(rows.rows[0].count).toBe(1); // Migration 008 bootstrap event remains.
    const triggers = await target.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'O'",
    );
    expect(triggers.rows[0].count).toBe(0);
    await restoreSnapshot(queryFor(target), snapshot);
    await verifySnapshot(queryFor(target), snapshot);
  }, 60000);

  it("rejects damaged snapshots and a changed migration history", async () => {
    validateSnapshot(snapshot, await migrations());
    const changed = structuredClone(snapshot);
    changed.tables.Tournament.rows[0].name = "unexpected edit";
    expect(() => validateSnapshot(changed, snapshot.migrations)).toThrow(
      "checksum",
    );
    expect(() => validateSnapshot(snapshot, [])).toThrow("migrations");
  });

  it("requires a direct encrypted Neon owner connection", () => {
    expect(
      neonUrl(
        "postgresql://owner:password@ep-demo.region.aws.neon.tech/neondb?sslmode=require",
      ).hostname,
    ).toBe("ep-demo.region.aws.neon.tech");
    for (const url of [
      "postgresql://owner:password@localhost/neondb?sslmode=require",
      "postgresql://owner:password@ep-demo-pooler.region.aws.neon.tech/neondb?sslmode=require",
      "postgresql://pailangz_app:password@ep-demo.region.aws.neon.tech/neondb?sslmode=require",
      "postgresql://owner:password@ep-demo.region.aws.neon.tech/neondb",
    ])
      expect(() => neonUrl(url)).toThrow("direct Neon owner");
  });

  it("explains missing or placeholder connections without exposing credentials", () => {
    for (const value of [
      undefined,
      "",
      "PASTE_DIRECT_NEON_OWNER_CONNECTION_HERE",
    ])
      expect(() => neonUrl(value)).toThrow("Set NEON_DATABASE_URL");
    expect(() =>
      neonUrl("psql 'postgresql://owner:private-password@host/database'"),
    ).toThrow("Paste only the postgresql:// connection string");
    try {
      neonUrl("postgresql://owner:private-password@[broken");
    } catch (error) {
      expect(String(error)).not.toContain("private-password");
    }
  });

  it("preserves quotes in private env values without silently changing credentials", () => {
    const values = {
      DATABASE_URL: "postgresql://user:p'ass@host/db?sslmode=require",
      DATA_ENCRYPTION_KEYS: '{"v1":"key"}',
    };
    expect(parse(envText(values))).toEqual(values);
    expect(() => envText({ SECRET: "line\nbreak" })).toThrow(
      "without changing",
    );
  });
});
