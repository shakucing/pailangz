import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { toText } from "hast-util-to-text";
import { toHtml } from "hast-util-to-html";

const parser = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, {
    ...defaultSchema,
    tagNames: [
      ...(defaultSchema.tagNames ?? []).filter((tag) => tag !== "input"),
      "u",
      "mark",
    ],
    strip: [
      ...(defaultSchema.strip ?? []),
      "style",
      "iframe",
      "object",
      "embed",
      "template",
      "svg",
      "math",
      "title",
      "noscript",
      "form",
      "input",
      "button",
    ],
  });

export function announcementHtmlTree(html: string) {
  return parser.runSync(parser.parse(html));
}

export function announcementEditorHtml(html: string) {
  return toHtml(announcementHtmlTree(html));
}

export function announcementLink(value: string) {
  const href = value.trim();
  if (!href || /[\s\u0000-\u001f\u007f]/.test(href)) return null;
  if (/^(?:\/(?!\/)|#)/.test(href) && !href.includes("\\")) return href;
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(href)) return href;
  if (/^[\w-]+(?:\.[\w-]+)+(?:[/:?#]|$)/.test(href)) return `https://${href}`;
  return null;
}

export function announcementExcerpt(html: string, maxLength = 220) {
  const text = toText(announcementHtmlTree(html)).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength - 1);
  const wordEnd = shortened.lastIndexOf(" ");
  return `${(wordEnd > 0 ? shortened.slice(0, wordEnd) : shortened).trimEnd()}…`;
}
