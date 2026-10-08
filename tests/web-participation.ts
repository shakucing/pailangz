import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { encrypt } from "../src/lib/crypto";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

export async function checkParticipationHttp(
  origin: string,
  owner: PrismaClient,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
  staffCookies: { admin: string; moderator: string },
) {
  const path = "/participate/pailangz-solo-team";
  const input = {
    ign: "HTTP participation player",
    tiktokId: "@PRIVATE_HTTP_PARTICIPATION",
  };
  const submit = (body: unknown, requestOrigin = origin) =>
    fetch(`${origin}/api/participation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      body: JSON.stringify(body),
    });
  await check(
    "full legacy roster closes the shared tournament link without a public CTA",
    async () => {
      for (const locale of ["en", "ms"]) {
        const response = await fetch(`${origin}${path}`, {
          headers: { Cookie: `pailangz_locale=${locale}` },
        });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
        assert.equal((html.match(/<input\b/g) ?? []).length, 0);
        assert.ok(
          html.includes(
            locale === "en" ? "Registration closed" : "Pendaftaran ditutup",
          ),
        );
        assert.ok(!html.includes('action="/api/participation"'));
        assert.ok(html.includes("SOLO") && html.includes("TEAM"));
        assert.ok(
          html.includes(
            locale === "en"
              ? "Limited to 64 players"
              : "Terhad kepada 64 pemain",
          ),
        );
        assert.ok(!html.includes(input.tiktokId));
      }
      for (const route of ["/", "/tournaments"]) {
        const html = await (await fetch(`${origin}${route}`)).text();
        assert.ok(!html.includes(`href="${path}"`));
      }
    },
  );
  await check(
    "participation API validates origin, size and identity with generic mismatch responses",
    async () => {
      assert.equal(
        (await submit(input, "https://untrusted.invalid")).status,
        403,
      );
      assert.equal((await submit({ ...input, ign: " " })).status, 400);
      assert.equal((await submit({ ...input, tiktokId: " " })).status, 400);
      assert.equal(
        (await submit({ ...input, ignored: "x".repeat(2001) })).status,
        413,
      );
      const missing = await submit(input);
      assert.equal(missing.status, 422);
      assert.deepEqual(await missing.json(), { error: "VERIFICATION_FAILED" });
      const memberId = randomUUID();
      await owner.member.create({
        data: {
          id: memberId,
          displayIgn: input.ign,
          canonicalIgn: input.ign.toLowerCase(),
          verified: true,
          privateData: {
            create: {
              originalIgn: input.ign,
              registrationEncrypted: encrypt(
                JSON.stringify({ "Tiktok ID": input.tiktokId }),
                `member:${memberId}`,
              ),
            },
          },
        },
      });
      const wrong = await submit({ ...input, tiktokId: "wrong-id" });
      assert.equal(wrong.status, 422);
      assert.deepEqual(await wrong.json(), { error: "VERIFICATION_FAILED" });
      const originalEvent = await owner.tournament.findUniqueOrThrow({
        where: { slug: "pailangz-solo-team" },
      });
      await owner.tournament.update({
        where: { id: originalEvent.id },
        data: { slug: `previous-${originalEvent.id}` },
      });
      const event = await owner.tournament.create({
        data: {
          slug: "pailangz-solo-team",
          name: "Participation HTTP test",
          registrationEnabled: true,
          overview: "Test",
          status: "REGISTRATION_OPEN",
          configuration: newTournamentConfiguration,
          categories: {
            create: [
              { kind: "SOLO", capacity: 32 },
              { kind: "TEAM", capacity: 8 },
            ],
          },
        },
      });
      await owner.integrationSetting.update({
        where: { key: "officialSeedTournament" },
        data: { value: event.id },
      });
      try {
        for (const locale of ["en", "ms"]) {
          const html = await (
            await fetch(`${origin}${path}`, {
              headers: { Cookie: `pailangz_locale=${locale}` },
            })
          ).text();
          assert.equal((html.match(/<input\b/g) ?? []).length, 2);
          for (const name of ["ign", "tiktokId"]) {
            const control = html.match(
              new RegExp(`<input[^>]*name="${name}"[^>]*>`),
            )?.[0];
            assert.ok(control?.includes('required=""'), `${name} is required`);
          }
        }
        for (let i = 0; i < 2; i++) {
          const response = await submit({
            ...input,
            category: "SOLO",
            eligible: true,
          });
          assert.equal(response.status, 202);
          assert.deepEqual(await response.json(), { accepted: true });
          assert.match(
            response.headers.get("cache-control") ?? "",
            /private.*no-store/,
          );
        }
        assert.equal(
          await owner.participationRequest.count({
            where: { memberId, tournamentId: event.id },
          }),
          1,
        );
        const slot = await owner.participant.findFirstOrThrow({
          where: { memberId, tournamentId: event.id },
        });
        assert.equal(slot.eligible, true);
        assert.equal(slot.provisional, false);
        assert.equal(slot.code, "P01");
        assert.equal(await owner.participant.count({ where: { memberId } }), 1);
        assert.equal(
          await owner.teamMembership.count({ where: { memberId } }),
          0,
        );
        for (const area of ["admin", "moderator"] as const) {
          const response = await fetch(`${origin}/${area}/participation`, {
            headers: { Cookie: staffCookies[area] },
          });
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.ok(html.includes(input.ign));
          assert.ok(html.includes("P01 · Eligible"));
          assert.ok(html.includes("Awaiting assignment"));
          assert.ok(!html.includes(input.tiktokId));
        }
        const audits = await owner.auditEvent.findMany({
          where: { action: "PARTICIPATION_SUBMIT" },
        });
        assert.ok(!JSON.stringify(audits).includes(input.tiktokId));
        const capacityMembers: string[] = [];
        try {
          const count = await owner.participationRequest.count({
            where: { tournamentId: event.id },
          });
          for (let i = count; i < 31; i++) {
            const id = randomUUID();
            capacityMembers.push(id);
            await owner.member.create({
              data: { id, displayIgn: id, canonicalIgn: id, verified: true },
            });
            await owner.participationRequest.create({
              data: { tournamentId: event.id, memberId: id },
            });
          }
          const beforeFull = await (await fetch(`${origin}${path}`)).text();
          assert.equal((beforeFull.match(/<input\b/g) ?? []).length, 2);
          const finalId = randomUUID();
          capacityMembers.push(finalId);
          await owner.member.create({
            data: {
              id: finalId,
              displayIgn: finalId,
              canonicalIgn: finalId,
              verified: true,
            },
          });
          await owner.participationRequest.create({
            data: { tournamentId: event.id, memberId: finalId },
          });
          for (const locale of ["en", "ms"]) {
            const html = await (
              await fetch(`${origin}${path}`, {
                headers: { Cookie: `pailangz_locale=${locale}` },
              })
            ).text();
            assert.equal((html.match(/<input\b/g) ?? []).length, 0);
            assert.ok(
              html.includes(
                locale === "en" ? "Registration closed" : "Pendaftaran ditutup",
              ),
            );
            assert.ok(
              html.includes(
                locale === "en"
                  ? "All tournament player slots are filled"
                  : "Semua slot pemain kejohanan telah diisi",
              ),
            );
            assert.ok(!html.includes('action="/api/participation"'));
          }
          const id = randomUUID();
          capacityMembers.push(id);
          await owner.member.create({
            data: {
              id,
              displayIgn: id,
              canonicalIgn: id,
              verified: true,
              privateData: {
                create: {
                  originalIgn: id,
                  registrationEncrypted: encrypt(
                    JSON.stringify({ "Tiktok ID": "http_capacity" }),
                    `member:${id}`,
                  ),
                },
              },
            },
          });
          const full = await submit({ ign: id, tiktokId: "http_capacity" });
          assert.equal(full.status, 409);
          assert.deepEqual(await full.json(), { error: "FULL" });
          assert.match(
            full.headers.get("cache-control") ?? "",
            /private.*no-store/,
          );
          assert.equal((await submit(input)).status, 202);
          const access = await fetch(`${origin}/api/member-access`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin },
            body: JSON.stringify({ ign: id, tiktokId: "http_capacity" }),
          });
          assert.equal(access.status, 200);
          const cookie = access.headers.get("set-cookie")?.split(";")[0];
          assert.ok(cookie);
          const teamPage = await (
            await fetch(`${origin}/tournaments/pailangz-solo-team/teams/new`, {
              headers: { Cookie: `${cookie}; pailangz_locale=en` },
            })
          ).text();
          assert.ok(teamPage.includes("Registration closed"));
          assert.ok(!teamPage.includes(`href="${path}"`));
          assert.equal(
            await owner.participationRequest.count({
              where: { tournamentId: event.id },
            }),
            32,
          );
        } finally {
          await owner.memberAccessSession.deleteMany({
            where: { memberId: { in: capacityMembers } },
          });
          await owner.participationRequest.deleteMany({
            where: { memberId: { in: capacityMembers } },
          });
          await owner.memberPrivate.deleteMany({
            where: { memberId: { in: capacityMembers } },
          });
          await owner.member.deleteMany({
            where: { id: { in: capacityMembers } },
          });
          const reopened = await (await fetch(`${origin}${path}`)).text();
          assert.equal((reopened.match(/<input\b/g) ?? []).length, 2);
        }
        await owner.tournament.update({
          where: { id: event.id },
          data: { status: "REGISTRATION_CLOSED" },
        });
        const closedPage = await (
          await fetch(`${origin}${path}`, {
            headers: { Cookie: "pailangz_locale=en" },
          })
        ).text();
        assert.equal((closedPage.match(/<input\b/g) ?? []).length, 0);
        assert.ok(
          closedPage.includes(
            "Tournament registration is unavailable or closed",
          ),
        );
        await owner.tournament.update({
          where: { id: event.id },
          data: { status: "REGISTRATION_OPEN" },
        });
        let limited = false;
        for (let i = 0; i < 10; i++) {
          const response = await submit({ ...input, tiktokId: "wrong-id" });
          if (response.status === 429) {
            assert.deepEqual(await response.json(), { error: "RATE_LIMIT" });
            limited = true;
            break;
          }
        }
        assert.ok(limited, "Identity checking must be rate-limited");
      } finally {
        await owner.tournament.update({
          where: { id: event.id },
          data: { slug: `participation-test-${event.id}` },
        });
        await owner.tournament.update({
          where: { id: originalEvent.id },
          data: { slug: "pailangz-solo-team" },
        });
        await owner.integrationSetting.update({
          where: { key: "officialSeedTournament" },
          data: { value: originalEvent.id },
        });
      }
    },
  );
}
