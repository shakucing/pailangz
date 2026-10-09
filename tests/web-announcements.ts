import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Run through web-isolated.ts --announcements, never against saved app data.
assert.equal(process.env.PAILANGZ_ISOLATED_WEB_TEST, "true");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const origin = process.env.NEXTAUTH_URL!;
const owner = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
  }),
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const email = `announcements-${randomUUID()}@synthetic.invalid`;
  const password = randomBytes(24).toString("base64url");
  await owner.staffUser.create({
    data: {
      name: "Disposable announcement QA",
      email,
      passwordHash: await hash(password, 12),
      role: "MODERATOR",
    },
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "dark",
  });
  await context.addCookies([
    { name: "pailangz_locale", value: "en", url: origin },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.goto(`${origin}/staff`);
  await page.getByLabel("Staff email").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Enter staff portal" }).click();
  await page.waitForURL(/\/moderator$/);

  const title = "Pengumuman kejohanan QA";
  const titleEn = "QA tournament announcement";
  const body =
    '<h2>Pendaftaran</h2>\n<p>Sertai <strong>pasukan anda</strong>. <a href="/tournaments">Lihat kejohanan</a>.</p>\n<ul><li>Pusingan pertama</li><li>Pusingan akhir</li></ul>\n<table><thead><tr><th>Masa</th><th>Acara</th></tr></thead><tbody><tr><td>8 malam</td><td>Akhir</td></tr></tbody></table>' +
    "<p>Maklumat lengkap kejohanan untuk semua pemain.</p>".repeat(120);
  const bodyEn =
    '<h2>Registration</h2>\n<p onclick="window.announcementInjected = true">Bring <strong>your team</strong>. <a href="/tournaments">View tournaments</a>.</p>\n<ul><li>First round</li><li>Final round</li></ul>\n<table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody><tr><td>8pm</td><td>Final</td></tr></tbody></table>\n<script>window.announcementInjected = true</script><style>body{display:none}</style>' +
    "<p>Full tournament information for every player.</p>".repeat(120);
  assert.ok(body.length > 5000 && bodyEn.length > 5000);

  async function saveDialog(label = "Save draft") {
    const response = page.waitForResponse(
      (response: { url(): string; request(): { method(): string } }) =>
        response.url() === `${origin}/api/staff` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: label, exact: true })
      .click();
    const saved = await response;
    const data = await saved.json();
    assert.equal(saved.status(), 200, JSON.stringify(data));
    await page.getByRole("dialog").getByRole("status").waitFor();
    return data.id as string;
  }

  async function pasteMessage(label: string, html: string) {
    const editor = page
      .getByRole("dialog")
      .getByRole("textbox", { name: label, exact: true });
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await editor.evaluate((element: HTMLElement, content: string) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/html", content);
      clipboard.setData("text/plain", "Pasted announcement");
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    }, html);
  }

  // Real saved HTML must open visually, including complete documents from the old form.
  const legacyBody =
    "<!DOCTYPE html><html><head><title>Document title</title><style>body{display:none}</style></head><body><h2>Existing announcement</h2><p>Keep <strong>the formatting</strong>.</p><script>window.announcementInjected = true</script></body></html>";
  const legacy = await owner.announcement.create({
    data: { title: "Legacy HTML announcement", body: legacyBody },
  });
  await page.goto(`${origin}/moderator/content`);
  await page
    .getByRole("button", {
      name: "Legacy HTML announcement · Draft",
      exact: true,
    })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Bahasa Melayu message", exact: true })
    .locator("h2")
    .waitFor();
  assert.equal(await dialog.locator("strong").innerText(), "the formatting");
  assert.equal(
    await page.evaluate(() => "announcementInjected" in window),
    false,
  );
  await saveDialog();
  assert.equal(
    (await owner.announcement.findUniqueOrThrow({ where: { id: legacy.id } }))
      .body,
    legacyBody,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  console.log(
    "PASS existing HTML opens formatted and unchanged saves preserve original content",
  );

  await page.goto(`${origin}/moderator/content`);
  await page
    .getByRole("button", { name: "Create announcement", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Write a Malay message" })
    .waitFor();
  const editor = dialog.getByRole("textbox", {
    name: "Bahasa Melayu message",
    exact: true,
  });
  await editor.fill("Toolbar check");
  assert.equal(
    await dialog.getByRole("alert").count(),
    0,
    "Correcting a message clears the stale validation error",
  );
  await editor.press("ControlOrMeta+A");
  await dialog.getByRole("button", { name: "Bold", exact: true }).click();
  assert.equal(await editor.locator("strong").innerText(), "Toolbar check");
  await dialog.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await editor.locator("strong").count(), 0);
  await dialog.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal(await editor.locator("strong").count(), 1);
  await dialog.getByRole("button", { name: "Italic", exact: true }).click();
  await dialog.getByRole("button", { name: "Underline", exact: true }).click();
  assert.equal(await editor.locator("em u, u em").count(), 1);
  await dialog
    .getByRole("combobox", {
      name: "Bahasa Melayu message text style",
      exact: true,
    })
    .selectOption("2");
  assert.equal(await editor.locator("h2").count(), 1);
  await dialog
    .getByRole("button", { name: "Bullet list", exact: true })
    .click();
  assert.ok((await editor.locator("ul li").count()) >= 1);
  await dialog
    .getByRole("button", { name: "Numbered list", exact: true })
    .click();
  assert.ok((await editor.locator("ol li").count()) >= 1);
  await dialog
    .getByRole("button", { name: "Add or edit link", exact: true })
    .click();
  await dialog
    .getByLabel("Website or page address")
    .fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "Apply link", exact: true }).click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: "Enter a website address" })
    .waitFor();
  await dialog.getByLabel("Website or page address").fill("/tournaments");
  await dialog.getByRole("button", { name: "Apply link", exact: true }).click();
  assert.equal(
    await editor.locator('a[href="/tournaments"]').innerText(),
    "Toolbar check",
  );
  assert.equal(await editor.locator("a strong").count(), 1);
  await editor.fill("Table check");
  await editor.press("End");
  await editor.press("Enter");
  await dialog
    .getByRole("button", { name: "Insert table", exact: true })
    .click();
  assert.equal(await editor.locator("table tr").count(), 3);
  await editor.locator("th").first().click();
  await dialog.getByRole("button", { name: "Add row", exact: true }).click();
  assert.equal(await editor.locator("table tr").count(), 4);
  await dialog.getByRole("button", { name: "Add column", exact: true }).click();
  assert.equal(
    await editor.locator("table tr").first().locator("th, td").count(),
    3,
  );
  await dialog
    .getByRole("button", { name: "Delete column", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Delete row", exact: true }).click();
  assert.equal(await editor.locator("table tr").count(), 3);
  await dialog
    .getByRole("button", { name: "Remove table", exact: true })
    .click();
  assert.equal(await editor.locator("table").count(), 0);
  console.log(
    "PASS rich text toolbar formats headings, emphasis, lists, links and tables with undo/redo",
  );
  await pasteMessage("Bahasa Melayu message", body);
  assert.ok(!(await editor.innerText()).includes("<h2>"));
  await dialog.getByLabel("Add English version").check();
  await dialog.getByRole("button", { name: "English", exact: true }).click();
  await dialog
    .getByLabel("English title (optional)", { exact: true })
    .fill(titleEn);
  await pasteMessage("English message (optional)", bodyEn);
  await dialog
    .getByRole("button", { name: "Bahasa Melayu", exact: true })
    .click();
  assert.equal(await dialog.locator('input[name="title"]').inputValue(), title);
  await dialog.getByRole("button", { name: "Preview", exact: true }).click();
  assert.equal(
    await dialog
      .locator('section[aria-label="Announcement preview"] h2')
      .filter({ hasText: "Pendaftaran" })
      .count(),
    1,
  );
  assert.equal(
    await dialog
      .locator('section[aria-label="Announcement preview"] strong')
      .filter({ hasText: "pasukan anda" })
      .count(),
    1,
  );
  await dialog.getByRole("button", { name: "Write", exact: true }).click();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await dialog.evaluate(
        (element: HTMLElement) => element.scrollWidth <= element.clientWidth,
      ),
      `Announcement form overflows at ${width}px`,
    );
    const actions = await dialog
      .getByRole("button", { name: "Save draft", exact: true })
      .boundingBox();
    assert.ok(
      actions && actions.y + actions.height <= 900,
      "Save actions remain visible",
    );
    if (process.env.PAILANGZ_QA_ARTIFACT_DIR && width === 320) {
      await mkdir(process.env.PAILANGZ_QA_ARTIFACT_DIR, { recursive: true });
      await dialog.screenshot({
        path: path.join(
          process.env.PAILANGZ_QA_ARTIFACT_DIR,
          "announcement-editor-mobile.png",
        ),
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  if (process.env.PAILANGZ_QA_ARTIFACT_DIR) {
    await mkdir(process.env.PAILANGZ_QA_ARTIFACT_DIR, { recursive: true });
    await dialog.screenshot({
      path: path.join(
        process.env.PAILANGZ_QA_ARTIFACT_DIR,
        "announcement-editor.png",
      ),
    });
  }
  const id = await saveDialog();
  let stored = await owner.announcement.findUniqueOrThrow({ where: { id } });
  const savedBody = stored.body;
  const savedBodyEn = stored.bodyEn;
  assert.ok(savedBody.length > 5000 && savedBodyEn!.length > 5000);
  assert.ok(savedBody.includes("<strong>pasukan anda</strong>"));
  assert.ok(!savedBodyEn!.match(/onclick|<script|<style|announcementInjected/));
  assert.equal(stored.published, false);
  console.log(
    "PASS create announcement saves more than 5,000 HTML characters in both languages and previews formatting",
  );
  assert.equal(await saveDialog(), id);
  assert.equal(
    await owner.announcement.count({ where: { title } }),
    1,
    "Repeated draft saves update the same announcement",
  );

  const publicPage = await context.newPage();
  publicPage.on("pageerror", (error: Error) => errors.push(error.message));
  await publicPage.goto(`${origin}/announcements/${id}`);
  await publicPage
    .getByRole("heading", { name: "This page is not available yet." })
    .waitFor();
  assert.equal(
    await publicPage
      .getByRole("heading", { name: titleEn, exact: true })
      .count(),
    0,
  );
  assert.ok(
    !(await publicPage.locator("main").innerText()).includes("your team"),
  );
  console.log("PASS drafts cannot be read by opening their public URL");

  await page.goto(`${origin}/moderator/content`);
  await page
    .getByRole("button", { name: `${title} · Draft`, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await dialog.locator('input[name="body"]').inputValue(),
    savedBody,
  );
  assert.equal(
    await dialog.locator('input[name="bodyEn"]').inputValue(),
    savedBodyEn,
  );
  await saveDialog("Publish announcement");

  await publicPage.goto(origin);
  const card = publicPage.locator(
    `#announcements a[href="/announcements/${id}"]`,
  );
  await card.waitFor();
  assert.ok((await card.innerText()).includes(titleEn));
  assert.ok(!(await card.innerText()).includes("<h2>"));
  assert.ok(!(await card.innerText()).includes("announcementInjected"));
  await card.click();
  await publicPage.waitForURL(`${origin}/announcements/${id}`);
  await publicPage
    .getByRole("heading", { name: titleEn, exact: true })
    .waitFor();
  assert.equal(
    await publicPage.locator("article strong").innerText(),
    "your team",
  );
  assert.equal(
    await publicPage.locator("article table td").last().innerText(),
    "Final",
  );
  assert.equal(
    await publicPage.locator('article a[href="/tournaments"]').count(),
    1,
  );
  assert.equal(
    await publicPage.evaluate(() => "announcementInjected" in window),
    false,
  );
  assert.equal(await publicPage.locator("article script").count(), 0);
  assert.equal(
    await publicPage.locator("article [onclick], article style").count(),
    0,
  );
  await publicPage.locator("article p").first().click();
  assert.equal(
    await publicPage.evaluate(() => "announcementInjected" in window),
    false,
  );
  console.log(
    "PASS landing announcement opens its formatted English page safely",
  );

  await context.addCookies([
    { name: "pailangz_locale", value: "ms", url: origin },
  ]);
  await publicPage.reload();
  await publicPage.getByRole("heading", { name: title, exact: true }).waitFor();
  assert.equal(
    await publicPage.locator("article strong").innerText(),
    "pasukan anda",
  );
  for (const width of [1280, 390]) {
    await publicPage.setViewportSize({ width, height: 900 });
    assert.ok(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Announcement overflows at ${width}px`,
    );
    if (process.env.PAILANGZ_QA_ARTIFACT_DIR) {
      await mkdir(process.env.PAILANGZ_QA_ARTIFACT_DIR, { recursive: true });
      await publicPage.screenshot({
        path: path.join(
          process.env.PAILANGZ_QA_ARTIFACT_DIR,
          `announcement-${width}.png`,
        ),
        fullPage: true,
      });
    }
  }
  await publicPage
    .getByRole("link", { name: "← Pengumuman gang", exact: true })
    .click();
  await publicPage.waitForURL(`${origin}/#announcements`);
  await card.waitFor();
  console.log("PASS Malay announcement, mobile layout and back link");

  await page.goto(`${origin}/moderator/content`);
  await page
    .getByRole("button", { name: `${title} · Published`, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "English", exact: true }).click();
  await dialog.getByLabel("English title (optional)", { exact: true }).fill("");
  await dialog
    .getByRole("textbox", { name: "English message (optional)", exact: true })
    .fill("");
  await saveDialog("Save changes");
  await context.addCookies([
    { name: "pailangz_locale", value: "en", url: origin },
  ]);
  await publicPage.goto(`${origin}/announcements/${id}`);
  await publicPage.getByRole("heading", { name: title, exact: true }).waitFor();
  assert.equal(
    await publicPage.locator("article strong").innerText(),
    "pasukan anda",
  );
  console.log(
    "PASS editing preserves HTML and empty English content falls back to Malay",
  );

  await saveDialog("Unpublish and save draft");
  await publicPage.reload();
  await publicPage
    .getByRole("heading", { name: "This page is not available yet." })
    .waitFor();
  await saveDialog("Publish announcement");
  await publicPage.reload();
  await publicPage.getByRole("heading", { name: title, exact: true }).waitFor();
  const emptyMessageStatus = await page.evaluate(
    async (announcement: { id: string; title: string }) => {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "announcement",
          data: { ...announcement, body: "<p><br></p>", published: true },
        }),
      });
      return response.status;
    },
    { id, title },
  );
  assert.equal(emptyMessageStatus, 400);
  assert.equal(
    (await owner.announcement.findUniqueOrThrow({ where: { id } })).body,
    savedBody,
  );
  console.log(
    "PASS unpublish and republish; the server rejects visually empty messages",
  );

  await page.goto(`${origin}/moderator/content`);
  const row = page
    .getByRole("button", { name: `${title} · Published`, exact: true })
    .locator("..")
    .locator("..");
  const archivedResponse = page.waitForResponse(
    (response: { url(): string; request(): { method(): string } }) =>
      response.url() === `${origin}/api/staff` &&
      response.request().method() === "POST",
  );
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  assert.equal((await archivedResponse).status(), 200);
  await publicPage.goto(`${origin}/announcements/${id}`);
  await publicPage
    .getByRole("heading", { name: "This page is not available yet." })
    .waitFor();
  await publicPage.goto(origin);
  assert.equal(await card.count(), 0);
  await page
    .getByRole("button", { name: `${title} · Archived`, exact: true })
    .waitFor();
  const archivedRow = page
    .getByRole("button", { name: `${title} · Archived`, exact: true })
    .locator("..")
    .locator("..");
  const restoredResponse = page.waitForResponse(
    (response: { url(): string; request(): { method(): string } }) =>
      response.url() === `${origin}/api/staff` &&
      response.request().method() === "POST",
  );
  await archivedRow
    .getByRole("button", { name: "Restore to draft", exact: true })
    .click();
  assert.equal((await restoredResponse).status(), 200);
  stored = await owner.announcement.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.archived, false);
  assert.equal(stored.published, false);
  await publicPage.goto(`${origin}/announcements/${randomUUID()}`);
  await publicPage
    .getByRole("heading", { name: "This page is not available yet." })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS archived and missing announcements stay unavailable; no browser errors",
  );
} finally {
  await browser.close();
  await owner.$disconnect();
}
