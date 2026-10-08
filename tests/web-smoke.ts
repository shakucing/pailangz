import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { newTournamentConfiguration } from "../src/lib/tournament-config";
import { encrypt } from "../src/lib/crypto";
if (process.env.PAILANGZ_ISOLATED_WEB_TEST !== "true")
  throw new Error(
    "Use pnpm test:web. Staff HTTP checks only run in its disposable database/server.",
  );
if (
  process.env.APP_ENV !== "development" ||
  process.env.DATABASE_ENV !== "development"
)
  throw new Error(
    "Web smoke tests require the synthetic development environment.",
  );
const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const owner = new PrismaClient({
  adapter: new PrismaPg({
    options: "-c timezone=UTC",
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
  }),
});
const password = randomBytes(32).toString("base64url");
const adminId = randomUUID(),
  modId = randomUUID(),
  email = `qa-${adminId}@synthetic.invalid`,
  modEmail = `qa-${modId}@synthetic.invalid`;
for (const [id, mail, role] of [
  [adminId, email, "ADMIN"],
  [modId, modEmail, "MODERATOR"],
] as const)
  await owner.staffUser.create({
    data: {
      id,
      email: mail,
      name: "Disposable synthetic QA operator",
      role,
      passwordHash: await hash(password, 12),
    },
  });
await owner.auditEvent.create({
  data: {
    actorRole: "SYSTEM",
    action: "QA_ACCOUNT_PROVISION",
    entityType: "STAFF",
    entityId: "synthetic-qa",
    correlationId: randomUUID(),
    source: "TEST",
    changes: { accountIds: [adminId, modId], synthetic: true },
    reason: "Disposable HTTP verification operators.",
  },
});
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
}
async function login(mail: string, suppliedPassword = password) {
  const csrfResponse = await fetch(`${origin}/api/auth/csrf`);
  const csrf = await csrfResponse.json();
  const body = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email: mail,
    password: suppliedPassword,
    callbackUrl: `${origin}/moderator`,
    json: "true",
  });
  const response = await fetch(`${origin}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies(csrfResponse),
      Origin: origin,
    },
    body,
    redirect: "manual",
  });
  const result = await response.json();
  return { response, result, cookie: cookies(response) };
}
async function post(cookie: string, action: string, data: unknown) {
  return fetch(`${origin}/api/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify({ action, data }),
  });
}
try {
  await check(
    "public interface supports persisted English and Malay locales",
    async () => {
      for (const [locale, heading] of [
        ["en", "PLAY TOGETHER."],
        ["ms", "MAIN BERSAMA."],
      ]) {
        const response = await fetch(origin, {
          headers: { Cookie: `pailangz_locale=${locale}` },
        });
        const html = await response.text();
        assert.match(html, new RegExp(`<html lang="${locale}"`));
        assert.ok(html.includes(heading));
        assert.ok(html.includes("pailangz-wordmark.webp"));
        assert.ok(
          html.includes("P01 · KingMinz"),
          "Landing fixtures include the approved SOLO name",
        );
        assert.ok(
          html.includes("Smith69"),
          "Landing roster includes the approved SOLO names",
        );
        assert.ok(!html.includes("In-game names stay private."));
        assert.match(
          response.headers.get("content-security-policy") ?? "",
          /nonce-/,
        );
      }
    },
  );
  await check(
    "anonymous guessed private IDs and evidence downloads are denied",
    async () => {
      const response = await post("", "privateDetails", {
        kind: "member",
        id: randomUUID(),
        role: "ADMIN",
      });
      assert.equal(response.status, 401);
      assert.match(
        response.headers.get("cache-control") ?? "",
        /private.*no-store/,
      );
      assert.equal(
        (await fetch(`${origin}/api/staff?evidence=${randomUUID()}`)).status,
        401,
      );
    },
  );
  await check(
    "incorrect or missing passwords cannot create a session",
    async () => {
      const attempted = await login(email, "incorrect-password");
      assert.match(attempted.result.url ?? "", /error/);
      const missing = await login(email, "");
      assert.match(missing.result.url ?? "", /error/);
      assert.ok(!missing.cookie.includes("session-token"));
    },
  );
  const admin = await login(email),
    mod = await login(modEmail);
  await check(
    "admin and moderator login succeeds with only email and password",
    async () => {
      assert.ok(!admin.result.url?.includes("error"));
      assert.ok(!mod.result.url?.includes("error"));
      assert.ok(admin.cookie.includes("session-token"));
      assert.ok(mod.cookie.includes("session-token"));
    },
  );
  await check(
    "password-only logins create independent revocable sessions",
    async () => {
      const second = await login(email);
      assert.ok(!second.result.url?.includes("error"));
      assert.ok(second.cookie.includes("session-token"));
      assert.notEqual(second.cookie, admin.cookie);
      assert.equal(
        await owner.staffSession.count({
          where: { userId: adminId, revoked: false },
        }),
        2,
      );
    },
  );
  await check(
    "all staff workflow pages render without leaking credential hashes",
    async () => {
      for (const section of [
        "",
        "/registrations",
        "/members",
        "/tournaments",
        "/teams",
        "/matches",
        "/content",
        "/imports",
        "/audit",
        "/settings",
        "/staff",
      ]) {
        const response = await fetch(`${origin}/admin${section}`, {
          headers: { Cookie: admin.cookie },
          redirect: "manual",
        });
        assert.equal(response.status, 200, section);
        const html = await response.text();
        assert.ok(!html.includes("$2b$12$"));
        assert.ok(!html.includes("Staff access has been revoked"));
        assert.ok(
          html.includes("Operations workspace"),
          section + " must render the authenticated workspace",
        );
        assert.ok(!html.includes("totpEncrypted"));
        const screenText = html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ");
        assert.doesNotMatch(
          screenText,
          /\bUUIDs?\b|\bJSON\b|ISO 8601|pnpm|owner CLI|admin-only API/i,
          section + " must use friendly screen copy",
        );

        assert.match(response.headers.get("cache-control") ?? "", /no-store/);
        if (section === "/matches") {
          assert.equal(
            (screenText.match(/Enter \/ correct score/g) ?? []).length,
            8,
            "the fixture page must render only eight score dialog triggers",
          );
          assert.ok(
            !/<form[^>]*class="form match-result-form"/.test(html),
            "score editors stay unmounted until opened",
          );
          assert.ok(html.includes("Show fixtures"));
        }
      }
    },
  );
  await check("moderator cannot elevate staff roles", async () => {
    const response = await post(mod.cookie, "staff", {
      id: adminId,
      role: "MODERATOR",
      suspended: true,
      reason: "Forbidden synthetic change",
    });
    assert.equal(response.status, 403);
    const denied = await fetch(`${origin}/admin`, {
      headers: { Cookie: mod.cookie },
      redirect: "manual",
    });
    const html = await denied.text();
    assert.ok(
      denied.status === 307 ||
        (denied.status === 200 && html.includes("NEXT_REDIRECT")),
    );
    assert.ok(!html.includes("Staff accounts</h1>"));
  });
  await check("member search finds records beyond the first page", async () => {
    const all = await owner.member.findMany({
      where: { archived: false },
      orderBy: { displayIgn: "asc" },
      select: { displayIgn: true },
    });
    assert.ok(all.length > 50, "the fixture must exercise pagination");
    const target = all.at(-1)!;
    const response = await fetch(
      `${origin}/admin/members?q=${encodeURIComponent(target.displayIgn)}&state=all`,
      { headers: { Cookie: admin.cookie } },
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    const screen = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    assert.ok(screen.includes(target.displayIgn));
    assert.match(screen, /Showing 1 of 1 member/);
    assert.ok(screen.includes("Search all members"));
  });
  await check(
    "member countries combine with search, status and pagination for both staff roles",
    async () => {
      const prefix = `Country QA ${randomUUID()}`;
      const canary = `PRIVATE_COUNTRY_CANARY_${randomUUID()}`;
      const fixtures = [
        ...Array.from({ length: 52 }, (_, i) => ({
          name: `${prefix} ${String(i).padStart(2, "0")}`,
          country: i % 2 ? " Malaysia " : "MY",
          verified: true,
          archived: false,
        })),
        {
          name: `${prefix} Pending`,
          country: "my",
          verified: false,
          archived: false,
        },
        {
          name: `${prefix} Archived`,
          country: "Malaysia",
          verified: true,
          archived: true,
        },
        {
          name: `${prefix} Indonesia`,
          country: "Indonesia",
          verified: true,
          archived: false,
        },
        {
          name: `${prefix} Missing`,
          country: null,
          verified: true,
          archived: false,
        },
        {
          name: `${prefix} Blank`,
          country: "",
          verified: true,
          archived: false,
        },
      ];
      const mapping = await owner.integrationSetting.findUnique({
        where: { key: "formMapping" },
      });
      const originalMapping = mapping!.value as {
        ign: string;
        phone: string;
        country: string;
      };
      try {
        for (const fixture of fixtures) {
          const id = randomUUID();
          await owner.member.create({
            data: {
              id,
              displayIgn: fixture.name,
              canonicalIgn: fixture.name.toLowerCase(),
              verified: fixture.verified,
              archived: fixture.archived,
              ...(fixture.country !== null
                ? {
                    privateData: {
                      create: {
                        originalIgn: fixture.name,
                        registrationEncrypted: encrypt(
                          JSON.stringify({
                            [originalMapping.country]: fixture.country,
                            "Tiktok ID": canary,
                          }),
                          `member:${id}`,
                        ),
                      },
                    },
                  }
                : {}),
            },
          });
        }
        async function directory(
          base: string,
          cookie: string,
          country: string,
          state = "active",
          page = 1,
        ) {
          const params = new URLSearchParams({
            q: prefix,
            country,
            state,
            page: String(page),
          });
          const response = await fetch(`${origin}${base}/members?${params}`, {
            headers: { Cookie: cookie },
          });
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.ok(
            !html.includes(canary),
            "filtering must not serialize private answers",
          );
          const screen = html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ");
          return { html, screen };
        }
        for (const [base, cookie] of [
          ["/admin", admin.cookie],
          ["/moderator", mod.cookie],
        ]) {
          const first = await directory(base, cookie, "MY");
          assert.match(first.screen, /Showing 50 of 53 members/);
          const nextHref = first.html.match(
            /href="([^"]+)"[^>]*>Next →<\/a>/,
          )?.[1];
          assert.ok(nextHref, "matching members must have a next page");
          const nextUrl = new URL(nextHref.replaceAll("&amp;", "&"), origin);
          assert.equal(nextUrl.searchParams.get("country"), "MY");
          assert.equal(nextUrl.searchParams.get("state"), "active");
          assert.equal(nextUrl.searchParams.get("q"), prefix);
          assert.equal(nextUrl.searchParams.get("page"), "2");
          assert.match(
            first.html,
            /<option value="MY" selected="">Malaysia<\/option>/,
          );
          assert.ok(!first.screen.includes(`${prefix} Indonesia`));
          assert.ok(!first.screen.includes(`${prefix} Archived`));
          const second = await directory(base, cookie, "MY", "active", 2);
          assert.match(second.screen, /Showing 3 of 53 members/);
          assert.ok(second.screen.includes(`${prefix} Pending`));
          assert.match(
            (await directory(base, cookie, "Malaysia", "pending")).screen,
            /Showing 1 of 1 member/,
          );
          assert.match(
            (await directory(base, cookie, "MY", "archived")).screen,
            /Showing 1 of 1 member/,
          );
          assert.match(
            (await directory(base, cookie, "MY", "all")).screen,
            /Showing 50 of 54 members/,
          );
          assert.match(
            (await directory(base, cookie, "ID")).screen,
            /Showing 1 of 1 member/,
          );
          assert.match(
            (await directory(base, cookie, "unspecified")).screen,
            /Showing 2 of 2 members/,
          );
          const empty = await directory(base, cookie, "SG");
          assert.match(empty.screen, /No members found/);
          assert.match(empty.screen, /Reset filters/);
          assert.match(
            (await directory(base, cookie, "")).screen,
            /Showing 50 of 56 members/,
          );
        }
        // Configured import columns take priority; standard web-form countries
        // still work when the configured answer is absent.
        await owner.integrationSetting.update({
          where: { key: "formMapping" },
          data: { value: { ...originalMapping, country: "Residence" } },
        });
        const target = await owner.member.findFirstOrThrow({
          where: { displayIgn: `${prefix} Indonesia` },
        });
        await owner.memberPrivate.update({
          where: { memberId: target.id },
          data: {
            registrationEncrypted: encrypt(
              JSON.stringify({ Country: "MY", Residence: "Indonesia" }),
              `member:${target.id}`,
            ),
          },
        });
        assert.match(
          (await directory("/admin", admin.cookie, "ID")).screen,
          /Showing 1 of 1 member/,
        );
        assert.match(
          (await directory("/admin", admin.cookie, "MY")).screen,
          /Showing 50 of 53 members/,
        );
      } finally {
        await owner.integrationSetting.update({
          where: { key: "formMapping" },
          data: { value: originalMapping },
        });
        await owner.memberPrivate.deleteMany({
          where: { member: { displayIgn: { startsWith: prefix } } },
        });
        await owner.member.deleteMany({
          where: { displayIgn: { startsWith: prefix } },
        });
      }
    },
  );
  await check(
    "all moderator workflow pages render without admin-only navigation",
    async () => {
      for (const section of [
        "",
        "/registrations",
        "/members",
        "/tournaments",
        "/teams",
        "/matches",
        "/content",
        "/imports",
        "/audit",
      ]) {
        const response = await fetch(`${origin}/moderator${section}`, {
          headers: { Cookie: mod.cookie },
        });
        assert.equal(response.status, 200);
        const html = await response.text();
        const screen = html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ");
        assert.ok(screen.includes("Operations workspace"), section);
        assert.ok(!screen.includes("Staff accounts"), section);
        assert.ok(!screen.includes("Registration settings"), section);
        assert.ok(!screen.includes("Publish (admin approval)"), section);
      }
    },
  );
  await check(
    "malformed JSON and oversized chunked staff requests fail with bounded errors",
    async () => {
      const requestHeaders = {
        "Content-Type": "application/json",
        Cookie: admin.cookie,
        Origin: origin,
      };
      assert.equal(
        (
          await fetch(`${origin}/api/staff`, {
            method: "POST",
            headers: requestHeaders,
            body: "{",
          })
        ).status,
        400,
      );
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2_000_001));
          controller.close();
        },
      });
      const oversized = await fetch(`${origin}/api/staff`, {
        method: "POST",
        headers: requestHeaders,
        body: stream,
        duplex: "half",
      } as RequestInit);
      assert.equal(oversized.status, 413);
    },
  );
  await check(
    "admin manages moderator accounts over HTTP without a reason; moderators are denied",
    async () => {
      const account = {
        name: "Disposable HTTP moderator",
        email: `http-${randomUUID()}@synthetic.invalid`,
        password,
        role: "MODERATOR",
      };
      assert.equal(
        (await post(mod.cookie, "staffCreate", account)).status,
        403,
      );
      const created = await post(admin.cookie, "staffCreate", account);
      assert.equal(created.status, 200);
      const { id } = await created.json();
      assert.ok(id);
      assert.equal(
        (await post(admin.cookie, "staffCreate", account)).status,
        409,
      );
      assert.equal(
        (
          await post(admin.cookie, "staffEdit", {
            id,
            name: "Edited HTTP moderator",
            role: "MODERATOR",
            suspended: true,
          })
        ).status,
        200,
      );
      assert.equal((await post(mod.cookie, "staffRemove", { id })).status, 403);
      assert.equal(
        (await post(admin.cookie, "staffRemove", { id })).status,
        200,
      );
      assert.equal(await owner.staffUser.count({ where: { id } }), 0);
      const events = await owner.auditEvent.findMany({
        where: { entityId: id },
      });
      assert.ok(events.some((event) => event.action === "STAFF_CREATE"));
      assert.ok(events.some((event) => event.action === "STAFF_DELETE"));
      assert.ok(!JSON.stringify(events).includes(password));
    },
  );
  await check(
    "configured tournament dialogs render and reject destructive capacity changes",
    async () => {
      const tournament = await owner.tournament.findUniqueOrThrow({
        where: { slug: "pailangz-solo-team" },
      });
      const response = await fetch(
        `${origin}/admin/tournaments?id=${tournament.id}`,
        { headers: { Cookie: admin.cookie } },
      );
      const html = await response.text();
      assert.ok(
        html.includes("Change tournament sizes") &&
          html.includes("Edit tournament rules") &&
          html.includes("Manage stage progression"),
      );
      const setupText = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ");
      assert.doesNotMatch(
        setupText,
        /\bUUIDs?\b|\bJSON\b|ISO 8601|RESTART_AND_RETAIN_HISTORY/,
      );
      assert.ok(html.includes('type="datetime-local"'));
      assert.ok(html.includes("Final player rankings"));
      const invalid = await post(mod.cookie, "configure", {
        id: tournament.id,
        configuration: newTournamentConfiguration,
        regenerate: true,
        reason: "Reject capacity that cannot retain original entrants",
      });
      assert.equal(invalid.status, 400);
      assert.match((await invalid.json()).error, /retain all 64/);
      assert.equal(
        (
          await post(mod.cookie, "revisionApply", {
            id: randomUUID(),
            acknowledgement: "RESTART_AND_RETAIN_HISTORY",
            reason: "Reject unauthorized revision application",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await owner.tournament.findUniqueOrThrow({
            where: { id: tournament.id },
          })
        ).configurationVersion,
        tournament.configurationVersion,
      );
    },
  );
  await check(
    "audit exports require staff access and record an audit event",
    async () => {
      const response = await post(admin.cookie, "auditExport", {
        reason: "Synthetic verification of audit export",
      });
      assert.equal(
        response.status,
        200,
        response.status === 200 ? undefined : await response.text(),
      );
      const body = await response.json();
      assert.ok(Array.isArray(body.records));
      assert.ok(body.records.length <= 1000);
      assert.ok(
        await owner.auditEvent.findFirst({
          where: { actorId: adminId, action: "AUDIT_EXPORT" },
        }),
      );
      assert.equal(
        (
          await post("", "auditExport", {
            reason: "Forbidden anonymous export",
          })
        ).status,
        401,
      );
    },
  );
  await check("cross-origin mutations fail", async () => {
    const response = await fetch(`${origin}/api/staff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: admin.cookie,
        Origin: "https://untrusted.invalid",
      },
      body: JSON.stringify({
        action: "member",
        data: { id: randomUUID(), ign: "forged", reason: "Forged" },
      }),
    });
    assert.equal(response.status, 403);
  });
  await check("bulk private export is disabled by default", async () =>
    assert.equal(
      (
        await post(admin.cookie, "privateExport", {
          reason: "Synthetic export attempt",
        })
      ).status,
      403,
    ),
  );
  await check(
    "synthetic CSV reaches approval inbox; import never provisions staff",
    async () => {
      const form = new FormData();
      form.set("action", "import");
      form.set(
        "file",
        new File(
          [
            "response_id,Timestamp,IGN,Whatsapp Number,Tiktok username,Tiktok ID,Discord Name,Discord ID,State/Province,Country,status\nqa-" +
              adminId +
              ",,QA " +
              adminId +
              ",PRIVATE_WEB_CANARY,,,,,,MY,ADMIN",
          ],
          "synthetic-qa.csv",
          { type: "text/csv" },
        ),
      );
      const response = await fetch(`${origin}/api/staff`, {
        method: "POST",
        headers: { Cookie: admin.cookie, Origin: origin },
        body: form,
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).created, 1);
      const submission = await owner.registrationSubmission.findUniqueOrThrow({
        where: {
          source_sourceResponseId: {
            source: "CSV",
            sourceResponseId: "qa-" + adminId,
          },
        },
      });
      assert.equal(submission.status, "PENDING");
      assert.ok(!submission.payloadEncrypted.includes("PRIVATE_WEB_CANARY"));
    },
  );
  await check(
    "public HTML / APIs / browser bundles omit private registration canary",
    async () => {
      for (const route of [
        "/",
        "/tournaments",
        "/register",
        "/api/tournaments/pailangz-solo-team",
      ]) {
        const response = await fetch(origin + route);
        const html = await response.text();
        assert.ok(!html.includes("PRIVATE_WEB_CANARY"));
        assert.ok(!html.includes(email));
        for (const match of html.matchAll(/src="([^\"]+\.js[^\"]*)"/g)) {
          const bundle = await fetch(
            new URL(match[1].replaceAll("&amp;", "&"), origin),
          );
          assert.ok(!(await bundle.text()).includes("PRIVATE_WEB_CANARY"));
        }
      }
      assert.equal(
        (await fetch(`${origin}/api/tournaments/pailangz-solo-team`)).status,
        404,
      );
    },
  );
  const { checkRegistrationHttp } = await import("./web-registration");
  await checkRegistrationHttp(origin, owner, check);
  const { checkParticipationHttp } = await import("./web-participation");
  await checkParticipationHttp(origin, owner, check, {
    admin: admin.cookie,
    moderator: mod.cookie,
  });
  const { checkTeamPortalHttp } = await import("./web-team-portal");
  await checkTeamPortalHttp(origin, owner, check);
  const { checkStaffTeamImages } = await import("./web-staff-team-images");
  await checkStaffTeamImages(origin, owner, check, admin.cookie, mod.cookie);
  const { checkModeratorSetupHttp } = await import("./web-moderator-setup");
  await checkModeratorSetupHttp(origin, mod.cookie, check);
  await check(
    "demoted / suspended staff lose existing-session private access",
    async () => {
      await owner.staffUser.update({
        where: { id: modId },
        data: { suspended: true, sessionVersion: { increment: 1 } },
      });
      await owner.staffSession.updateMany({
        where: { userId: modId },
        data: { revoked: true },
      });
      assert.equal(
        (
          await post(mod.cookie, "privateDetails", {
            kind: "member",
            id: randomUUID(),
          })
        ).status,
        403,
      );
    },
  );
  await check(
    "webhooks stay disconnected and audit records omit plaintext private canary",
    async () => {
      assert.equal(
        (
          await fetch(`${origin}/api/registration/webhook`, {
            method: "POST",
            body: "{}",
          })
        ).status,
        503,
      );
      const events = await owner.auditEvent.findMany();
      assert.ok(!JSON.stringify(events).includes("PRIVATE_WEB_CANARY"));
    },
  );
  console.log(
    `${passed} HTTP workflow checks passed. Disposable accounts will now be suspended and all QA sessions revoked.`,
  );
} finally {
  await owner.$transaction(async (tx) => {
    await tx.registrationSubmission.updateMany({
      where: { source: "CSV", sourceResponseId: "qa-" + adminId },
      data: { status: "REJECTED" },
    });
    await tx.staffUser.updateMany({
      where: { id: { in: [adminId, modId] } },
      data: { suspended: true, sessionVersion: { increment: 1 } },
    });
    await tx.staffSession.updateMany({
      where: { userId: { in: [adminId, modId] } },
      data: { revoked: true },
    });
    await tx.auditEvent.create({
      data: {
        actorRole: "SYSTEM",
        action: "QA_ACCOUNT_REVOKE",
        entityType: "STAFF",
        entityId: "synthetic-qa",
        correlationId: randomUUID(),
        source: "TEST",
        changes: { accountIds: [adminId, modId], revoked: true },
        reason: "Disposable HTTP verification operators revoked.",
      },
    });
  });
  await owner.$disconnect();
}
