import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlContent } from "../src/components/html-content";
import {
  announcementEditorHtml,
  announcementExcerpt,
  announcementLink,
} from "../src/lib/announcement-content";

const mocks = vi.hoisted(() => ({ announcement: vi.fn(), locale: vi.fn() }));
vi.mock("../src/lib/public-data", () => ({
  publicAnnouncement: mocks.announcement,
  dateText: () => "9 October 2026",
}));
vi.mock("../src/lib/i18n", () => ({
  getLocale: mocks.locale,
  translate: (locale: string, ms: string, en: string) =>
    locale === "en" ? en : ms,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
vi.mock("../src/components/navigation-link", () => ({
  NavigationLink: ({ children, ...props }: { children: ReactNode }) =>
    createElement("a", props, children),
}));
import { AnnouncementCard } from "../src/components/announcement-card";
import AnnouncementPage, {
  generateMetadata,
} from "../src/app/announcements/[id]/page";

function renderHtml(content: string) {
  return renderToStaticMarkup(
    createElement(HtmlContent, { children: content }),
  );
}

describe("announcement HTML", () => {
  it("renders HTML headings, emphasis, links, lists and tables", () => {
    const html = renderHtml(
      '<h2>Match day</h2><p><strong>Ready</strong> and <em>waiting</em>. <a href="/tournaments">Register</a></p><ul><li>Bring your team</li><li><del>Old rule</del></li></ul><table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody><tr><td>8pm</td><td>Final</td></tr></tbody></table><blockquote>Good luck</blockquote><pre><code>score: 3</code></pre>',
    );
    expect(html).toContain("<h2>Match day</h2>");
    expect(html).toContain("<strong>Ready</strong>");
    expect(html).toContain("<em>waiting</em>");
    expect(html).toContain('href="/tournaments"');
    expect(html).toContain("<li>Bring your team</li>");
    expect(html).toContain("<del>Old rule</del>");
    expect(html).toContain("<th>Time</th>");
    expect(html).toContain("<td>Final</td>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("score: 3");
  });

  it("keeps ordinary text readable without interpreting Markdown", () => {
    expect(renderHtml("Existing plain text.")).toContain(
      "Existing plain text.",
    );
    expect(renderHtml("**Ready**")).toContain("**Ready**");
    expect(renderHtml("**Ready**")).not.toContain("<strong>");
  });

  it("removes scripts, event handlers, CSS, embedded frames and unsafe links", () => {
    const html = renderHtml(
      '<p onclick="alert(1)" style="position:fixed">Safe <strong>copy</strong>.</p><script>alert(1)</script><style>body{display:none}</style><iframe srcdoc="unsafe"></iframe><img onerror="alert(2)"><a href="jav&#x61;script:alert(1)">click</a><svg onload="alert(3)"><text>SVG canary</text></svg><math><mtext>Math canary</mtext></math><input name="email"><form>Form canary</form>',
    );
    expect(html).toContain("<strong>copy</strong>");
    expect(html).not.toMatch(
      /<script|onclick|onerror|onload|javascript:|style=|<style|<iframe|<svg|<math|<input|<form/i,
    );
    expect(html).not.toMatch(
      /alert\(|display:none|SVG canary|Math canary|Form canary/,
    );
  });

  it("creates decoded text excerpts without HTML tags, executable content or link targets", () => {
    expect(
      announcementExcerpt(
        '<h2>Match day</h2><p><strong>Ready</strong> for <a href="/tournaments">registration</a>.</p><ul><li>First round</li><li>Final round</li></ul>',
      ),
    ).toBe("Match day Ready for registration. First round Final round");
    expect(
      announcementExcerpt(
        "<script>alert(1)</script><style>body{display:none}</style><p>Public update</p>",
      ),
    ).toBe("Public update");
    expect(
      announcementExcerpt(
        '<p>PAILANGZ &amp; friends&nbsp;<a href="https://example.com">Sign up</a></p>',
      ),
    ).toBe("PAILANGZ & friends Sign up");
    const excerpt = announcementExcerpt(
      "Welcome to the community tournament. ".repeat(20),
    );
    expect(excerpt.length).toBeLessThanOrEqual(220);
    expect(excerpt).toMatch(/…$/);
  });

  it("prepares existing documents and pasted HTML for the editor without executable content", () => {
    const html = announcementEditorHtml(
      '<!DOCTYPE html><html><head><title>Private title</title><style>body{display:none}</style></head><body><h2>Update</h2><p onclick="alert(1)"><strong>Bring your team</strong> &amp; friends.</p><script>alert(1)</script></body></html>',
    );
    expect(html).toContain("<h2>Update</h2>");
    expect(html).toContain("<strong>Bring your team</strong>");
    expect(html).not.toMatch(/script|onclick|<style|Private title|alert\(/);
    const long = "<p>Full announcement details.</p>".repeat(300);
    expect(announcementEditorHtml(long)).toBe(long);
    expect(announcementExcerpt("<p><br></p>")).toBe("");
  });

  it("accepts useful announcement links and rejects executable or malformed URLs", () => {
    for (const href of [
      "/tournaments",
      "#registration",
      "https://example.com",
      "http://example.com",
      "mailto:staff@example.com",
      "tel:+60123456789",
    ])
      expect(announcementLink(href)).toBe(href);
    expect(announcementLink(" example.com/registration ")).toBe(
      "https://example.com/registration",
    );
    for (const href of [
      "",
      "javascript:alert(1)",
      "data:text/html,test",
      "//example.com",
      "/\\example.com",
      "java\nscript:alert(1)",
      "not a link",
    ])
      expect(announcementLink(href)).toBeNull();
  });
});

describe("public announcements", () => {
  beforeEach(() => {
    mocks.locale.mockResolvedValue("en");
    mocks.announcement.mockResolvedValue({
      id: "published-announcement",
      title: "Tournament update",
      body: "<h2>Registration</h2><p>Bring <strong>your team</strong>.</p>",
      createdAt: new Date("2026-10-09T00:00:00Z"),
    });
  });

  it("links the landing card to the full announcement with a plain excerpt", () => {
    const html = renderToStaticMarkup(
      createElement(AnnouncementCard, {
        announcement: {
          id: "published-announcement",
          title: "Tournament update",
          body: "<h2>Registration</h2><p>Bring <strong>your team</strong>.</p>",
        },
        locale: "en",
      }),
    );
    expect(html).toContain('href="/announcements/published-announcement"');
    expect(html).toContain("Registration Bring your team.");
    expect(html).toContain("Read announcement");
    expect(html).not.toContain("<strong>your team</strong>");
  });

  it("renders the detail page and plain-text metadata", async () => {
    const params = Promise.resolve({ id: "published-announcement" });
    const html = renderToStaticMarkup(await AnnouncementPage({ params }));
    expect(html).toContain("Tournament update</h1>");
    expect(html).toContain("<h2>Registration</h2>");
    expect(html).toContain("<strong>your team</strong>");
    expect(html).toContain('href="/#announcements"');
    expect(await generateMetadata({ params })).toEqual({
      title: "Tournament update",
      description: "Registration Bring your team.",
    });
  });

  it("returns not found when an announcement is unavailable", async () => {
    mocks.announcement.mockResolvedValue(null);
    const params = Promise.resolve({ id: "hidden-announcement" });
    await expect(AnnouncementPage({ params })).rejects.toThrow("404");
    await expect(generateMetadata({ params })).rejects.toThrow("404");
  });
});
