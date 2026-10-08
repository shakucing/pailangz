"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { teamImageError, TEAM_IMAGE_TYPES } from "@/lib/team-avatar-policy";
import { friendlyError, type Choice } from "@/lib/staff-presentation";
import { SelectionField } from "./guided-fields";
import { TeamAvatar } from "./team-avatar";
import { useDialogForm } from "./workspace-dialog";
import styles from "./team-portal.module.css";

export function TeamRosterForm({
  categoryId,
  players,
  team,
}: {
  categoryId: string;
  players: Choice[];
  team?: {
    id: string;
    name: string;
    memberIds: string[];
    archived: boolean;
    avatarImage: string | null;
  };
}) {
  const router = useRouter();
  const uid = useId();
  const imageInput = useRef<HTMLInputElement>(null);
  const [teamId, setTeamId] = useState(team?.id);
  const [name, setName] = useState(team?.name ?? "");
  const [savedImage, setSavedImage] = useState(team?.avatarImage ?? null);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const dialogForm = useDialogForm(busy);

  useEffect(() => {
    setPreview(null);
    if (!image) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.onerror = () => {
      setImage(null);
      if (imageInput.current) imageInput.current.value = "";
      setFeedback({
        error: true,
        text: "Unable to read this image. Choose another file.",
      });
    };
    reader.readAsDataURL(image);
    return () => {
      reader.abort();
    };
  }, [image]);

  const visibleImage = image ? preview : removeImage ? null : savedImage;
  function resetImage() {
    setImage(null);
    setPreview(null);
    if (imageInput.current) imageInput.current.value = "";
  }

  return (
    <form
      className="form"
      onChange={dialogForm.onChange}
      onClick={dialogForm.onClick}
      onSubmit={async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        setBusy(true);
        setFeedback(null);
        try {
          const payload = new FormData();
          payload.set("action", "team");
          payload.set(
            "data",
            JSON.stringify({
              id: teamId,
              categoryId,
              name,
              memberIds: JSON.parse(String(fields.get("memberIds") ?? "[]")),
              archived: fields.has("archived"),
              removeImage,
              reason: String(fields.get("reason") ?? ""),
            }),
          );
          if (image) payload.set("image", image);
          const response = await fetch("/api/staff", {
            method: "POST",
            body: payload,
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error);
          setTeamId(body.id);
          setSavedImage(body.avatarImage ?? null);
          resetImage();
          setRemoveImage(false);
          setFeedback({ error: false, text: "Team saved." });
          dialogForm.onSaved();
          router.refresh();
        } catch (error) {
          setFeedback({
            error: true,
            text: friendlyError(
              error instanceof Error
                ? error.message
                : "Unable to save the team.",
            ),
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="form-fields" disabled={busy}>
        <label>
          Team name
          <input
            name="name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className={styles.imageUpload}>
          <div
            role="img"
            aria-label={
              visibleImage ? "Team image preview" : "Team initials preview"
            }
          >
            <TeamAvatar image={visibleImage} name={name} />
          </div>
          <div className={styles.imageFields}>
            <label htmlFor={`${uid}-image`}>
              Team image (optional)
              <input
                ref={imageInput}
                id={`${uid}-image`}
                type="file"
                accept={TEAM_IMAGE_TYPES.join(",")}
                aria-describedby={`${uid}-image-help`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const invalid = teamImageError(file);
                  if (invalid) {
                    event.target.value = "";
                    setFeedback({ error: true, text: friendlyError(invalid) });
                    return;
                  }
                  setFeedback(null);
                  setImage(file);
                  setRemoveImage(false);
                }}
              />
            </label>
            <p id={`${uid}-image-help`} className="muted text-xs">
              PNG, JPEG or WebP, up to 4 MB. Images are cropped to a square and
              shown as a circular team avatar. Choose a new file to replace the
              image.
            </p>
            {(image || (savedImage && !removeImage)) && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  resetImage();
                  setRemoveImage(Boolean(savedImage));
                  setFeedback(null);
                }}
              >
                Remove image
              </button>
            )}
            {savedImage && (image || removeImage) && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  resetImage();
                  setRemoveImage(false);
                  setFeedback(null);
                }}
              >
                Keep current image
              </button>
            )}
            {removeImage && (
              <p className="muted text-xs" role="status">
                The image will be removed when you save the team.
              </p>
            )}
          </div>
        </div>
        <SelectionField
          name="memberIds"
          label={teamId ? "Team players" : "Choose team players"}
          value={team?.memberIds}
          options={players}
          max={4}
          help="Choose up to four approved players. Names already on another team are unavailable. Remove a selected name using the × button."
        />
        {teamId && (
          <label className="choice-row">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={team?.archived ?? false}
            />
            Archive this team
          </label>
        )}
        <label>
          Note (optional)
          <input
            name="reason"
            maxLength={1000}
            placeholder="Add a note if useful"
          />
        </label>
        <button
          className="button"
          type="submit"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "Saving…" : teamId ? "Save team" : "Create team"}
        </button>
      </fieldset>
      {feedback && (
        <p
          className={`feedback ${feedback.error ? "error" : ""}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}
