"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DialogActions, useDialogForm } from "./workspace-dialog";
import { ActionFeedback } from "./action-feedback";
import { HtmlContent } from "./html-content";
import { RichTextField } from "./rich-text-field";
import { announcementExcerpt } from "@/lib/announcement-content";
import { friendlyError } from "@/lib/staff-presentation";
import styles from "./announcement-form.module.css";

type Announcement = {
  id: string;
  title: string;
  body: string;
  titleEn: string | null;
  bodyEn: string | null;
  published: boolean;
  archived: boolean;
};

export function AnnouncementForm({ initial }: { initial?: Announcement }) {
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [id, setId] = useState(initial?.id);
  const [published, setPublished] = useState(initial?.published ?? false);
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [language, setLanguage] = useState<"ms" | "en">("ms");
  const [english, setEnglish] = useState(
    Boolean(initial?.titleEn || initial?.bodyEn),
  );
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [titleEn, setTitleEn] = useState(initial?.titleEn ?? "");
  const [bodyEn, setBodyEn] = useState(initial?.bodyEn ?? "");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<"title" | "body" | null>(null);
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const dialogForm = useDialogForm(busy);

  function clearValidation(field: "title" | "body") {
    if (invalid === field) {
      setInvalid(null);
      setFeedback(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const issue =
      title.trim().length < 3
        ? "title"
        : announcementExcerpt(body, 4).length < 3
          ? "body"
          : null;
    if (issue) {
      setInvalid(issue);
      setLanguage("ms");
      setPreview(false);
      setFeedback({
        text:
          issue === "title"
            ? "Enter a Malay title with at least 3 characters."
            : "Write a Malay message with at least 3 characters.",
        error: true,
      });
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>(
            issue === "title"
              ? '[name="title"]'
              : '[role="textbox"][aria-label="Bahasa Melayu message"]',
          )
          ?.focus(),
      );
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const nextPublished = submitter?.value === "publish";
    const reason = String(
      new FormData(event.currentTarget).get("reason") ?? "",
    );
    setBusy(true);
    setFeedback(null);
    setInvalid(null);
    try {
      const response = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "announcement",
          data: {
            id,
            title: title.trim(),
            body,
            titleEn: english ? titleEn.trim() : "",
            bodyEn: english ? bodyEn : "",
            published: nextPublished,
            archived: false,
            reason,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setId(result.id);
      setPublished(nextPublished);
      setArchived(false);
      setFeedback({
        text: nextPublished
          ? published && !archived
            ? "Changes saved. The announcement is live."
            : "Announcement published."
          : "Draft saved. You can return and finish it later.",
        error: false,
      });
      dialogForm.onSaved();
      router.refresh();
    } catch (error) {
      setFeedback({
        text:
          error instanceof Error
            ? friendlyError(error.message)
            : "Unable to save the announcement.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id={uid}
      ref={form}
      className={`form ${styles.form}`}
      data-action="announcement"
      noValidate
      onChange={dialogForm.onChange}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
      onSubmit={save}
    >
      <fieldset className="form-fields" disabled={busy}>
        <div className={styles.topRow}>
          <span className={styles.status}>
            {archived ? "Archived" : published ? "Published" : "Draft"}
          </span>
          <label className="choice-row">
            <input
              type="checkbox"
              checked={english}
              onChange={(event) => {
                setEnglish(event.target.checked);
                if (!event.target.checked) setLanguage("ms");
              }}
            />
            Add English version
          </label>
        </div>
        {english && (
          <div
            className={styles.tabs}
            role="group"
            aria-label="Announcement language"
          >
            <button
              type="button"
              aria-pressed={language === "ms"}
              onClick={() => setLanguage("ms")}
            >
              Bahasa Melayu
            </button>
            <button
              type="button"
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              English
            </button>
          </div>
        )}
        <div
          className={styles.tabs}
          role="group"
          aria-label="Announcement view"
        >
          <button
            type="button"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            Preview
          </button>
        </div>
        <div hidden={preview || language !== "ms"} className={styles.fields}>
          <label>
            Title
            <input
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                clearValidation("title");
              }}
              minLength={3}
              maxLength={150}
              required
              aria-invalid={invalid === "title"}
              placeholder="What is the announcement about?"
            />
          </label>
          <RichTextField
            name="body"
            label="Bahasa Melayu message"
            value={body}
            disabled={busy}
            invalid={invalid === "body"}
            onChange={(value) => {
              setBody(value);
              clearValidation("body");
              dialogForm.onChange();
            }}
          />
        </div>
        <div hidden={preview || language !== "en"} className={styles.fields}>
          <label>
            English title (optional)
            <input
              name="titleEn"
              value={titleEn}
              maxLength={150}
              onChange={(event) => setTitleEn(event.target.value)}
              placeholder="Uses the Malay title if left empty"
            />
          </label>
          <RichTextField
            name="bodyEn"
            label="English message (optional)"
            value={bodyEn}
            disabled={busy}
            onChange={(value) => {
              setBodyEn(value);
              dialogForm.onChange();
            }}
          />
          <p className="muted text-xs mb-0">
            Empty English fields use the Malay version.
          </p>
        </div>
        {preview && (
          <section className={styles.preview} aria-label="Announcement preview">
            <p className="eyebrow">
              {language === "ms"
                ? "Pengumuman komuniti"
                : "Community announcement"}
            </p>
            <h3 className={styles.previewTitle}>
              {(language === "en" ? titleEn.trim() || title : title) ||
                "Announcement title"}
            </h3>
            <article className="panel">
              {(language === "en" ? bodyEn || body : body).trim() ? (
                <HtmlContent>
                  {language === "en" ? bodyEn || body : body}
                </HtmlContent>
              ) : (
                <p className="muted mb-0">Your message will appear here.</p>
              )}
            </article>
          </section>
        )}
        <details className={styles.options}>
          <summary>Internal note (optional)</summary>
          <label>
            Note
            <input
              name="reason"
              placeholder="Add context for other staff"
              maxLength={1000}
            />
          </label>
        </details>
      </fieldset>
      <DialogActions>
        <div className={styles.actions}>
          {feedback && (
            <ActionFeedback text={feedback.text} error={feedback.error} />
          )}
          <div className={styles.actionButtons}>
            <button
              form={uid}
              type="submit"
              name="intent"
              value="draft"
              className="button secondary"
              disabled={busy}
            >
              {busy
                ? "Saving…"
                : published && !archived
                  ? "Unpublish and save draft"
                  : archived
                    ? "Restore as draft"
                    : "Save draft"}
            </button>
            <button
              form={uid}
              type="submit"
              name="intent"
              value="publish"
              className="button"
              disabled={busy}
            >
              {busy
                ? "Saving…"
                : published && !archived && id
                  ? "Save changes"
                  : archived
                    ? "Restore and publish"
                    : "Publish announcement"}
            </button>
          </div>
        </div>
      </DialogActions>
    </form>
  );
}
