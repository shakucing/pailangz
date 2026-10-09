"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link,
  Table,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  announcementEditorHtml,
  announcementLink,
} from "@/lib/announcement-content";
import contentStyles from "./html-content.module.css";
import styles from "./rich-text-field.module.css";

export function RichTextField({
  name,
  label,
  value,
  onChange,
  disabled = false,
  invalid = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const uid = useId();
  const [initialContent] = useState(() => announcementEditorHtml(value));
  const update = useRef(onChange);
  update.current = onChange;
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const selection = useRef({ from: 0, to: 0 });
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          defaultProtocol: "https",
          HTMLAttributes: { target: null, rel: "noopener noreferrer" },
        },
      }),
      TableKit,
      Placeholder.configure({ placeholder: "Write your announcement here…" }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        id: uid,
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        "aria-describedby": `${uid}-help`,
      },
      transformPastedHTML: announcementEditorHtml,
    },
    onUpdate: ({ editor: current }) => {
      update.current(current.isEmpty ? "" : current.getHTML());
    },
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    editor?.view.dom.setAttribute("aria-invalid", String(invalid));
  }, [editor, invalid]);

  function tool(
    label: string,
    icon: ReactNode,
    run: () => void,
    active?: boolean,
    unavailable = false,
  ) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={active}
        disabled={!editor || disabled || unavailable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={run}
      >
        {icon}
      </button>
    );
  }

  function openLink() {
    if (!editor) return;
    if (editor.isActive("link")) editor.commands.extendMarkRange("link");
    selection.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    setLinkUrl(String(editor.getAttributes("link").href ?? ""));
    setLinkText(
      editor.state.doc.textBetween(
        selection.current.from,
        selection.current.to,
      ),
    );
    setLinkError("");
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const href = announcementLink(linkUrl);
    if (!href) {
      setLinkError(
        "Enter a website address, page path, email link, or phone link.",
      );
      return;
    }
    const { from, to } = selection.current;
    const text = linkText.trim() || href;
    if (from !== to && text === editor.state.doc.textBetween(from, to)) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setLink({ href })
        .run();
      setLinkOpen(false);
      return;
    }
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from, to },
        {
          type: "text",
          text,
          marks: [{ type: "link", attrs: { href } }],
        },
      )
      .run();
    setLinkOpen(false);
  }

  return (
    <div className={styles.field}>
      <label htmlFor={uid}>{label}</label>
      <input type="hidden" name={name} value={value} />
      <div className={styles.frame} data-invalid={invalid || undefined}>
        <div
          className={styles.toolbar}
          role="group"
          aria-label={`${label} formatting`}
        >
          <select
            aria-label={`${label} text style`}
            value={
              editor?.isActive("heading")
                ? String(editor.getAttributes("heading").level)
                : "paragraph"
            }
            disabled={!editor || disabled}
            onChange={(event) => {
              if (event.target.value === "paragraph")
                editor?.chain().focus().setParagraph().run();
              else
                editor
                  ?.chain()
                  .focus()
                  .setHeading({
                    level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6,
                  })
                  .run();
            }}
          >
            <option value="paragraph">Normal text</option>
            <option value="2">Heading</option>
            <option value="3">Subheading</option>
            {[1, 4, 5, 6].map((level) => (
              <option key={level} value={level} hidden>
                Heading {level}
              </option>
            ))}
          </select>
          {tool(
            "Bold",
            <Bold size={16} />,
            () => editor?.chain().focus().toggleBold().run(),
            editor?.isActive("bold"),
          )}
          {tool(
            "Italic",
            <Italic size={16} />,
            () => editor?.chain().focus().toggleItalic().run(),
            editor?.isActive("italic"),
          )}
          {tool(
            "Underline",
            <Underline size={16} />,
            () => editor?.chain().focus().toggleUnderline().run(),
            editor?.isActive("underline"),
          )}
          <span className={styles.separator} aria-hidden="true" />
          {tool(
            "Bullet list",
            <List size={16} />,
            () => editor?.chain().focus().toggleBulletList().run(),
            editor?.isActive("bulletList"),
          )}
          {tool(
            "Numbered list",
            <ListOrdered size={16} />,
            () => editor?.chain().focus().toggleOrderedList().run(),
            editor?.isActive("orderedList"),
          )}
          {tool(
            "Add or edit link",
            <>
              <Link size={16} />
              <span>Link</span>
            </>,
            openLink,
            editor?.isActive("link"),
          )}
          {tool(
            "Insert table",
            <>
              <Table size={16} />
              <span>Table</span>
            </>,
            () =>
              editor
                ?.chain()
                .focus()
                .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
                .run(),
            undefined,
            editor?.isActive("table"),
          )}
          {tool(
            "Undo",
            <Undo2 size={16} />,
            () => editor?.chain().focus().undo().run(),
            undefined,
            !editor?.can().undo(),
          )}
          {tool(
            "Redo",
            <Redo2 size={16} />,
            () => editor?.chain().focus().redo().run(),
            undefined,
            !editor?.can().redo(),
          )}
        </div>
        {linkOpen && (
          <div
            className={styles.linkPanel}
            role="group"
            aria-label="Edit link"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                event.target instanceof HTMLInputElement
              ) {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setLinkOpen(false);
                editor?.commands.focus();
              }
            }}
          >
            <label>
              Link text
              <input
                value={linkText}
                disabled={disabled}
                onChange={(event) => setLinkText(event.target.value)}
              />
            </label>
            <label>
              Website or page address
              <input
                autoFocus
                value={linkUrl}
                placeholder="https://example.com or /tournaments"
                disabled={disabled}
                onChange={(event) => setLinkUrl(event.target.value)}
              />
            </label>
            {linkError && (
              <p role="alert" className="feedback error">
                {linkError}
              </p>
            )}
            <div className={styles.linkActions}>
              <button
                type="button"
                className="button small"
                disabled={disabled}
                onClick={applyLink}
              >
                Apply link
              </button>
              <button
                type="button"
                className="button secondary small"
                disabled={disabled}
                onClick={() => {
                  setLinkOpen(false);
                  editor?.commands.focus();
                }}
              >
                Cancel
              </button>
              {editor?.isActive("link") && (
                <button
                  type="button"
                  className="button secondary small"
                  disabled={disabled}
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .setTextSelection(selection.current)
                      .unsetLink()
                      .run();
                    setLinkOpen(false);
                  }}
                >
                  Remove link
                </button>
              )}
            </div>
          </div>
        )}
        {editor?.isActive("table") && (
          <div
            className={styles.tableTools}
            role="group"
            aria-label="Edit table"
          >
            {[
              ["Add row", () => editor.chain().focus().addRowAfter().run()],
              [
                "Add column",
                () => editor.chain().focus().addColumnAfter().run(),
              ],
              ["Delete row", () => editor.chain().focus().deleteRow().run()],
              [
                "Delete column",
                () => editor.chain().focus().deleteColumn().run(),
              ],
              [
                "Remove table",
                () => editor.chain().focus().deleteTable().run(),
              ],
            ].map(([label, run]) => (
              <button
                type="button"
                key={String(label)}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={run as () => void}
              >
                {String(label)}
              </button>
            ))}
          </div>
        )}
        <EditorContent
          editor={editor}
          className={`${contentStyles.content} ${styles.editor}`}
        />
        {!editor && (
          <p className={styles.loading} role="status">
            Loading editor…
          </p>
        )}
      </div>
      <p id={`${uid}-help`} className="muted text-xs mb-0">
        Write or paste your message, then use the toolbar to format it.
      </p>
    </div>
  );
}
