import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { privateTx, type Actor } from "../src/lib/db";
import { encrypt } from "../src/lib/crypto";
import { newTournamentConfiguration as soloDefaults } from "../src/lib/tournament-config";
import {
  assignParticipants,
  changeEntrant,
  generateTournamentLeague,
  configureTournament,
  applyRevision,
} from "../src/lib/configuration";
import {
  saveTournament,
  confirmRules,
  publishTournament,
  submitResult,
  reviewResult,
  standingsFor,
  freezeRankings,
} from "../src/lib/competition";
import {
  confirmMapping,
  teamUpdate,
  announcementUpdate,
  settingUpdate,
} from "../src/lib/operations";
import { submitParticipation } from "../src/lib/participation";
import {
  participationStatus,
  registrationEvent,
} from "../src/lib/participation-status";
import {
  publicTeamEvent,
  startMemberAccess,
  mutateTeam,
  teamState,
} from "../src/lib/team-portal";

const { format: _format, ...newTournamentConfiguration } = soloDefaults;

export async function checkModeratorSetup(
  owner: pg.Client,
  mod: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const slug = `moderator-setup-${randomUUID()}`;
  const config = {
    ...newTournamentConfiguration,
    soloCapacity: 8,
    teamCapacity: 2,
    teamBracketSize: 2,
    leagueRounds: 1,
    leagueMatchesPerPlayer: 1,
    soloBracketSize: 4,
    directSlots: 4,
    playoffSlots: 0,
    playoffEntrants: 0,
  };
  const input = {
    name: "Moderator independent event",
    slug,
    overview: "Shared event information",
    overviewEn: "English event details",
    status: "DRAFT",
    registrationEnabled: true,
    configuration: config,
    gameTitle: "Test game",
    startsAt: "2030-01-02T12:00:00Z",
    registrationDeadline: "2030-01-01T12:00:00Z",
    reason: "",
  };
  const event = await saveTournament(mod, input);
  const people: {
    id: string;
    ign: string;
    tiktokId: string;
    tournamentSlug: string;
  }[] = [];
  for (let n = 0; n < 35; n++) {
    const id = randomUUID();
    const person = {
      id,
      ign: `Setup player ${id}`,
      tiktokId: `setup_${n}`,
      tournamentSlug: slug,
    };
    people.push(person);
    await owner.query(
      'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ($1,$2,$3,true)',
      [id, person.ign, person.ign.toLowerCase()],
    );
    await owner.query(
      'INSERT INTO "MemberPrivate" ("memberId","originalIgn","registrationEncrypted") VALUES ($1,$2,$3)',
      [
        id,
        person.ign,
        encrypt(
          JSON.stringify({ "Tiktok ID": person.tiktokId }),
          `member:${id}`,
        ),
      ],
    );
  }
  await check(
    "moderator opens per-event registration and team pages without publishing fixtures",
    async () => {
      assert.equal(await participationStatus(slug), "OPEN");
      assert.equal((await registrationEvent(slug))?.capacity, 8);
      assert.equal((await publicTeamEvent(slug))?.slug, slug);
      await owner.query("BEGIN");
      try {
        await owner.query("SET LOCAL ROLE pailangz_app");
        assert.equal(
          (
            await owner.query('SELECT * FROM "Tournament" WHERE id=$1', [
              event.id,
            ])
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM "Stage" WHERE "categoryId" IN (SELECT id FROM "Category" WHERE "tournamentId"=$1)',
              [event.id],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (await owner.query('SELECT * FROM "MemberPrivate"')).rowCount,
          0,
        );
      } finally {
        await owner.query("ROLLBACK");
      }
      for (const person of people.slice(0, 8))
        await submitParticipation(person);
      assert.equal(await participationStatus(slug), "FULL");
      await submitParticipation(people[0]);
      await assert.rejects(submitParticipation(people[8]), /FULL/);
      const token = await startMemberAccess(people[0]);
      const team = await mutateTeam(token, slug, {
        action: "CREATE",
        name: "First team",
      });
      assert.equal((await teamState(token, slug, team.slug))?.isOwner, true);
    },
  );
  let firstSlot = "";
  let archivedStage = "";
  await check(
    "moderator replaces a draft entrant, transfers ownership and retains old fixtures",
    async () => {
      await generateTournamentLeague(mod, { id: event.id, reason: "" });
      firstSlot = (
        await privateTx(mod, (tx) =>
          tx.participant.findUniqueOrThrow({
            where: {
              tournamentId_memberId: {
                tournamentId: event.id,
                memberId: people[0].id,
              },
            },
          }),
        )
      ).id;
      archivedStage = (
        await privateTx(mod, (tx) =>
          tx.stage.findFirstOrThrow({
            where: {
              category: { tournamentId: event.id },
              key: "league",
              archived: false,
            },
          }),
        )
      ).id;
      // A late audit failure must roll back the roster, owner transfer and archived stages together.
      await owner.query(`CREATE FUNCTION test_reject_replacement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PARTICIPANT_REPLACE' THEN RAISE EXCEPTION 'Test replacement audit failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_reject_replacement_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_replacement_audit()`);
      try {
        await assert.rejects(
          changeEntrant(mod, {
            id: firstSlot,
            replacementMemberId: people[8].id,
            reason: "Must roll back atomically",
          }),
          /Test replacement audit failure/,
        );
      } finally {
        await owner.query(
          'DROP TRIGGER test_reject_replacement_audit ON "AuditEvent"; DROP FUNCTION test_reject_replacement_audit()',
        );
      }
      assert.equal(
        (
          await privateTx(mod, (tx) =>
            tx.participant.findUniqueOrThrow({ where: { id: firstSlot } }),
          )
        ).withdrawn,
        false,
      );
      assert.equal(
        (
          await privateTx(mod, (tx) =>
            tx.stage.findUniqueOrThrow({ where: { id: archivedStage } }),
          )
        ).archived,
        false,
      );
      await changeEntrant(mod, {
        id: firstSlot,
        replacementMemberId: people[8].id,
        reason: "Original player unavailable",
      });
      const old = await privateTx(mod, (tx) =>
        tx.participant.findUniqueOrThrow({ where: { id: firstSlot } }),
      );
      assert.equal(old.withdrawn, true);
      assert.equal(old.memberId, people[0].id);
      assert.equal(old.eligible, false);
      assert.equal(
        (
          await privateTx(mod, (tx) =>
            tx.stage.findUniqueOrThrow({ where: { id: archivedStage } }),
          )
        ).archived,
        true,
      );
      assert.equal(
        await privateTx(mod, (tx) =>
          tx.match.count({
            where: {
              round: { stageId: archivedStage },
              OR: [{ sideAId: firstSlot }, { sideBId: firstSlot }],
            },
          }),
        ),
        1,
      );
      assert.equal(
        await privateTx(mod, (tx) =>
          tx.match.count({
            where: {
              round: {
                stage: {
                  category: { tournamentId: event.id },
                  archived: false,
                },
              },
              OR: [{ sideAId: firstSlot }, { sideBId: firstSlot }],
            },
          }),
        ),
        0,
      );
      const transferred = await privateTx(mod, (tx) =>
        tx.team.findFirstOrThrow({
          where: { category: { tournamentId: event.id } },
        }),
      );
      assert.equal(transferred.ownerId, people[8].id);
      assert.equal(await participationStatus(slug), "FULL");
      await assert.rejects(submitParticipation(people[0]), /WITHDRAWN/);
      await assert.rejects(
        changeEntrant(mod, { id: firstSlot, reason: "No repeated withdrawal" }),
        /already withdrawn/,
      );
    },
  );
  await check(
    "withdrawal frees capacity and staff can restore the same historical entry",
    async () => {
      const second = await privateTx(mod, (tx) =>
        tx.participant.findUniqueOrThrow({
          where: {
            tournamentId_memberId: {
              tournamentId: event.id,
              memberId: people[1].id,
            },
          },
        }),
      );
      await changeEntrant(mod, {
        id: second.id,
        reason: "Player taking a break",
      });
      assert.equal(await participationStatus(slug), "OPEN");
      await assert.rejects(submitParticipation(people[1]), /WITHDRAWN/);
      await assignParticipants(mod, {
        id: event.id,
        memberIds: [people[1].id],
        eligible: true,
        reason: "Player returned",
      });
      assert.equal(await participationStatus(slug), "FULL");
      assert.equal(
        (
          await privateTx(mod, (tx) =>
            tx.participant.findUniqueOrThrow({ where: { id: second.id } }),
          )
        ).withdrawn,
        false,
      );
      await generateTournamentLeague(mod, {
        id: event.id,
        reason: "Restore full schedule",
      });
    },
  );
  await check(
    "moderator confirms every stage, player list, publication and announcements",
    async () => {
      const stages = await privateTx(mod, (tx) =>
        tx.stage.findMany({
          where: { category: { tournamentId: event.id }, archived: false },
        }),
      );
      const rules = {
        seriesPoints: true,
        drawPolicy: "no_draws",
        tiebreakers: ["differential"],
        knockoutPairing: "ranked_cross",
        teamSeeding: "manual",
        specialOutcomes: "forfeit",
        evidenceDeadline: "Within one hour",
        disputeDeadline: "Within one day",
      };
      for (const stage of stages)
        await confirmRules(mod, {
          stageId: stage.id,
          rules,
          confirmedRules: Object.keys(rules),
          reason: "",
        });
      const category = await privateTx(mod, (tx) =>
        tx.category.findUniqueOrThrow({
          where: {
            tournamentId_kind: { tournamentId: event.id, kind: "TEAM" },
          },
        }),
      );
      const firstTeam = await privateTx(mod, (tx) =>
        tx.team.findFirstOrThrow({ where: { categoryId: category.id } }),
      );
      await teamUpdate(mod, {
        id: firstTeam.id,
        categoryId: category.id,
        name: firstTeam.name,
        memberIds: [people[8].id, ...people.slice(1, 4).map((p) => p.id)],
        reason: "",
      });
      await teamUpdate(mod, {
        categoryId: category.id,
        name: "Second team",
        memberIds: people.slice(4, 8).map((p) => p.id),
        reason: "",
      });
      await confirmMapping(mod, { id: event.id, reason: "" });
      await saveTournament(mod, {
        ...input,
        id: event.id,
        status: "REGISTRATION_OPEN",
      });
      await publishTournament(mod, {
        id: event.id,
        published: true,
        reason: "",
      });
      assert.equal(await participationStatus(slug), "CLOSED");
      const token = await startMemberAccess(people[8]);
      await assert.rejects(
        mutateTeam(token, slug, { action: "CREATE", name: "Published roster" }),
        /CLOSED/,
      );
      await assert.rejects(
        confirmRules(mod, {
          stageId: stages[0].id,
          rules,
          confirmedRules: Object.keys(rules),
          reason: "",
        }),
        /locked/,
      );
      const a = await announcementUpdate(mod, {
        title: "Event ready",
        body: "Tournament begins soon",
        published: true,
        reason: "",
      });
      await announcementUpdate(mod, {
        id: a.id,
        title: "Updated event",
        body: "Tournament begins soon",
        published: false,
        reason: "",
      });
      await publishTournament(mod, {
        id: event.id,
        published: false,
        reason: "",
      });
    },
  );
  await check(
    "moderator records and freezes rankings while started-roster edits and controlled restarts stay protected",
    async () => {
      const stage = await privateTx(mod, (tx) =>
        tx.stage.findFirstOrThrow({
          where: {
            category: { tournamentId: event.id },
            key: "league",
            archived: false,
          },
        }),
      );
      const matches = await privateTx(mod, (tx) =>
        tx.match.findMany({
          where: { round: { stageId: stage.id } },
          orderBy: { order: "asc" },
        }),
      );
      for (const [index, match] of matches.entries()) {
        const result = await submitResult(mod, {
          matchId: match.id,
          idempotencyKey: randomUUID(),
          outcome: "A_WIN",
          games: [
            { scoreA: index + 1, scoreB: 0 },
            { scoreA: index + 1, scoreB: 0 },
          ],
          reason: "",
        });
        await privateTx(mod, (tx) =>
          tx.evidence.create({
            data: {
              resultId: result.id,
              storageKey: randomUUID(),
              mime: "image/png",
              size: 1,
              uploadedBy: mod.id,
            },
          }),
        );
        await reviewResult(mod, {
          id: result.id,
          action: "ACCEPT",
          reason: "",
        });
      }
      const rows = (await privateTx(mod, (tx) => standingsFor(tx, stage.id)))
        .rows;
      await freezeRankings(mod, {
        stageId: stage.id,
        rankedIds: rows.map((r) => r.id),
        reason: "Final ranking checked",
      });
      await assert.rejects(
        changeEntrant(mod, { id: rows[0].id, reason: "Cannot alter results" }),
        /restart/,
      );
      const proposal = await configureTournament(mod, {
        id: event.id,
        configuration: config,
        regenerate: true,
        reason: "Propose a competition restart",
      });
      assert.equal(proposal.status, "PENDING");
      await assert.rejects(
        applyRevision(mod, {
          id: proposal.id,
          acknowledgement: "RESTART_AND_RETAIN_HISTORY",
          reason: "No moderator override",
        }),
        /Admin permission/,
      );
      await assert.rejects(
        settingUpdate(mod, { key: "formMapping", value: {}, reason: "" }),
        /Admin permission/,
      );
    },
  );
  await check(
    "new-event signup uses capacities above 32, isolates events and serializes the final place",
    async () => {
      const secondSlug = `${slug}-large`;
      const largeConfig = { ...newTournamentConfiguration, soloCapacity: 34 };
      const large = await saveTournament(mod, {
        ...input,
        slug: secondSlug,
        configuration: largeConfig,
      });
      // Staff assignment and public signup share the same capacity and tournament lock.
      await assignParticipants(mod, {
        id: large.id,
        memberIds: people.slice(0, 33).map((p) => p.id),
        eligible: true,
        reason: "",
      });
      assert.equal(await participationStatus(secondSlug), "OPEN");
      const outcomes = await Promise.allSettled(
        people
          .slice(33, 35)
          .map((p) =>
            submitParticipation({ ...p, tournamentSlug: secondSlug }),
          ),
      );
      assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await participationStatus(secondSlug), "FULL");
      assert.equal(
        await privateTx(mod, (tx) =>
          tx.participant.count({
            where: { tournamentId: large.id, withdrawn: false },
          }),
        ),
        34,
      );
      await saveTournament(mod, {
        ...input,
        id: large.id,
        slug: secondSlug,
        registrationEnabled: false,
      });
      assert.equal(await participationStatus(secondSlug), "CLOSED");
      assert.equal(await registrationEvent(secondSlug), null);
      assert.equal(await publicTeamEvent(secondSlug), null);
      await assert.rejects(
        submitParticipation({ ...people[0], tournamentSlug: secondSlug }),
        /CLOSED/,
      );
      assert.equal(await participationStatus("missing-event"), "CLOSED");
    },
  );
}
