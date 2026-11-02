import assert from "node:assert/strict";
import { participationProfile } from "./participation-profile-fixture";
import { newTournamentConfiguration } from "../src/lib/tournament-config";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../src/lib/crypto";

assert.equal(process.env.PAILANGZ_ISOLATED_WEB_TEST, "true");
const origin = process.env.NEXTAUTH_URL!;
const owner = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
  }),
});
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
async function login(role: "ADMIN" | "MODERATOR") {
  const email = `non-family-${randomUUID()}@synthetic.invalid`;
  const password = randomBytes(24).toString("base64url");
  await owner.staffUser.create({
    data: {
      email,
      name: "Non-family QA",
      role,
      passwordHash: await hash(password, 12),
    },
  });
  const csrfResponse = await fetch(`${origin}/api/auth/csrf`);
  const csrf = await csrfResponse.json();
  const response = await fetch(`${origin}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies(csrfResponse),
      Origin: origin,
    },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email,
      password,
      json: "true",
      callbackUrl: origin,
    }),
    redirect: "manual",
  });
  assert.ok(cookies(response).includes("session-token"));
  return cookies(response);
}
async function staff(cookie: string, action: string, data: unknown) {
  const response = await fetch(`${origin}/api/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify({ action, data }),
  });
  assert.equal(response.status, 200, await response.text());
}
async function screen(cookie: string, path: string) {
  const response = await fetch(`${origin}${path}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  assert.ok(
    !text.includes("Unable to load this page") &&
      !text.includes("Halaman tidak dapat dimuatkan"),
  );
  return { html, text };
}
async function stats(cookie: string, base: string) {
  const { text } = await screen(cookie, base);
  const match = text.match(
    /Total profiles (\d+) Members (\d+) Non-members (\d+)/,
  );
  assert.ok(match, "overview renders the total and membership breakdown");
  return match.slice(1).map(Number);
}
try {
  const admin = await login("ADMIN"),
    moderator = await login("MODERATOR");
  const baseline = await stats(admin, "/admin");
  const submissions = [];
  for (const [ign, nonFamily, familyName] of [
    ["Stitch non-family blank", true, ""],
    ["Stitch non-family named", true, "PRIVATE_FAMILY_CANARY"],
    ["Stitch regular member", false, ""],
  ] as const) {
    const requestId = randomUUID();
    const response = await fetch(`${origin}/api/registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        requestId,
        ign,
        nonFamily,
        familyName,
        gmcId: "QA-GMC",
        whatsapp: "+60 12 345 6789",
        email: "qa@example.com",
        tiktokUsername: "QA",
        tiktokId: "@qa",
        country: "MY",
      }),
    });
    assert.equal(response.status, 202);
    submissions.push(requestId);
  }
  for (const [cookie, base] of [
    [admin, "/admin"],
    [moderator, "/moderator"],
  ]) {
    const { text } = await screen(cookie, `${base}/registrations`);
    assert.ok(text.includes("Stitch non-family blank"));
    assert.ok(text.includes("Stitch non-family named"));
    assert.ok(text.includes("Stitch regular member"));
    const directory = await screen(cookie, `${base}/non-members?state=active`);
    assert.ok(!directory.text.includes("Stitch non-family blank"));
    assert.ok(!directory.text.includes("Stitch non-family named"));
    assert.ok(
      !directory.text.includes("Non-family registrations awaiting review"),
    );
    assert.ok(!text.includes("PRIVATE_FAMILY_CANARY"));
  }
  console.log(
    "PASS new applications stay in the Registration inbox for both roles until approved",
  );
  await staff(admin, "review", {
    id: submissions[1],
    action: "CLARIFY",
    reason: "Synthetic review",
  });
  assert.ok(
    (await screen(admin, "/admin/registrations")).text.includes(
      "Stitch non-family named",
    ),
  );
  assert.deepEqual(await stats(admin, "/admin"), baseline);
  await staff(admin, "approveRegistrations", { ids: submissions });
  const approvedStats = [baseline[0] + 3, baseline[1] + 1, baseline[2] + 2];
  assert.deepEqual(await stats(admin, "/admin"), approvedStats);
  assert.deepEqual(await stats(moderator, "/moderator"), approvedStats);
  let page = await screen(admin, "/admin/non-members");
  assert.ok(page.text.includes("Stitch non-family blank"));
  assert.ok(page.text.includes("Stitch non-family named"));
  assert.ok(!page.text.includes("Stitch regular member"));
  assert.match(page.text, /Showing 2 of 2 non-member\s*s/);
  assert.ok(!page.text.includes("Non-family registrations awaiting review"));
  const approvedForModerator = await screen(
    moderator,
    "/moderator/non-members",
  );
  assert.ok(approvedForModerator.text.includes("Stitch non-family blank"));
  console.log(
    "PASS approval places non-family profiles in Non-members, including empty family names",
  );
  const regular = await owner.member.findFirstOrThrow({
    where: { displayIgn: "Stitch regular member" },
  });
  await staff(admin, "member", { id: regular.id, isMember: false });
  assert.deepEqual(await stats(admin, "/admin"), [
    baseline[0] + 3,
    baseline[1],
    baseline[2] + 3,
  ]);
  assert.ok(
    (await screen(admin, "/admin/non-members")).text.includes(
      "Stitch regular member",
    ),
  );
  await staff(admin, "member", { id: regular.id, isMember: true });
  assert.ok(
    !(await screen(admin, "/admin/non-members")).text.includes(
      "Stitch regular member",
    ),
  );
  assert.ok(
    (
      await screen(admin, "/admin/non-members?country=MY&q=blank")
    ).text.includes("Stitch non-family blank"),
  );
  assert.ok(
    !(await screen(admin, "/admin/non-members?country=ID")).text.includes(
      "Stitch non-family blank",
    ),
  );
  const exported = await fetch(`${origin}/api/staff/members/export`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: admin,
      Origin: origin,
    },
    body: JSON.stringify({ format: "csv", state: "non-members" }),
  });
  assert.equal(exported.status, 200);
  const csv = await exported.text();
  assert.ok(
    csv.includes("Stitch non-family blank") &&
      csv.includes("Stitch non-family named"),
  );
  assert.ok(!csv.includes("Stitch regular member"));
  console.log(
    "PASS membership changes, search, country filters and exports use the correct directory",
  );
  // Exercise public requests after a membership change and a non-family approval.
  const event = await owner.tournament.create({
    data: {
      slug: `membership-${randomUUID()}`,
      name: "Membership independence QA",
      overview: "Synthetic test",
      status: "REGISTRATION_OPEN",
      registrationEnabled: true,
      configuration: newTournamentConfiguration,
      categories: { create: { kind: "SOLO", capacity: 32 } },
    },
  });
  await staff(admin, "member", { id: regular.id, isMember: false });
  for (const ign of ["Stitch non-family blank", "Stitch regular member"]) {
    const response = await fetch(`${origin}/api/participation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        ign,
        tiktokId: "@qa",
        tournamentSlug: event.slug,
        profile: participationProfile,
        soloTermsRead: true,
        soloIgnDisplayConsent: true,
      }),
    });
    assert.equal(response.status, 202, await response.text());
    const participant = await owner.participant.findFirstOrThrow({
      where: { tournamentId: event.id, member: { displayIgn: ign } },
      include: { member: true },
    });
    assert.equal(participant.eligible, true);
    assert.equal(participant.member.isMember, false);
    const access = await fetch(`${origin}/api/member-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ ign, tiktokId: "@qa" }),
    });
    assert.equal(access.status, 200, await access.text());
    assert.ok(cookies(access).includes("pailangz_member"));
  }
  console.log(
    "PASS approved non-family and former members register through the public API and sign in without changing membership",
  );
  if (process.env.PLAYWRIGHT_MODULE) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
        });
        await context.addCookies(
          admin.split("; ").map((cookie) => {
            const separator = cookie.indexOf("=");
            return {
              name: cookie.slice(0, separator),
              value: cookie.slice(separator + 1),
              url: origin,
            };
          }),
        );
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));
        page.on("dialog", (dialog: { accept: () => Promise<void> }) =>
          dialog.accept(),
        );
        await page.goto(
          `${origin}/admin/non-members?q=Stitch%20regular%20member`,
        );
        const add = page.getByRole("button", {
          name: "Add member Stitch regular member",
          exact: true,
        });
        await add.click();
        await add.waitFor({ state: "hidden" });
        await page.goto(`${origin}/admin/members?q=Stitch%20regular%20member`);
        const remove = page.getByRole("button", {
          name: "Remove membership Stitch regular member",
          exact: true,
        });
        await remove.click();
        await remove.waitFor({ state: "hidden" });
        await page.goto(
          `${origin}/admin/non-members?q=Stitch%20regular%20member`,
        );
        await page
          .getByRole("button", {
            name: "Add member Stitch regular member",
            exact: true,
          })
          .waitFor();
        assert.ok(
          (await page.locator("main").innerText()).includes("Non-member"),
        );
        assert.ok(
          !(await page.locator("main").innerText()).includes("Archived"),
        );
        assert.deepEqual(errors, []);
        await context.close();
        console.log(
          `PASS membership buttons move profiles between directories at ${width}px without browser errors`,
        );
      }
    } finally {
      await browser.close();
    }
  }
  const pageNames = Array.from(
    { length: 51 },
    (_, i) => `Stitch pagination ${String(i).padStart(2, "0")}`,
  );
  for (const displayIgn of pageNames) {
    const id = randomUUID();
    await owner.member.create({
      data: {
        id,
        displayIgn,
        canonicalIgn: displayIgn.toLowerCase(),
        verified: true,
        privateData: {
          create: {
            originalIgn: displayIgn,
            registrationEncrypted: encrypt(
              JSON.stringify({
                "Non-family": "Yes",
                "Family Name": "",
                Country: "MY",
              }),
              `member:${id}`,
            ),
          },
        },
      },
    });
  }
  page = await screen(
    admin,
    "/admin/non-members?q=Stitch%20pagination&country=MY",
  );
  assert.ok(page.html.includes("page=2"));
  assert.match(page.text, /51 records · page 1/);
  const firstNames = pageNames.filter((name) => page.text.includes(name));
  assert.equal(firstNames.length, 50);
  const second = await screen(
    admin,
    "/admin/non-members?q=Stitch%20pagination&country=MY&page=2",
  );
  assert.equal(
    pageNames.filter((name) => second.text.includes(name)).length,
    1,
  );
  assert.equal(
    pageNames.filter(
      (name) => page.text.includes(name) || second.text.includes(name),
    ).length,
    51,
  );
  console.log(
    "PASS non-family filtering precedes pagination and all matching profiles are reachable",
  );
} finally {
  await owner.$disconnect();
}
