"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, PrivateDetails } from "./action-form";
import { staffRequest } from "@/lib/staff-request";
import { friendlyLabel } from "@/lib/staff-presentation";
import styles from "./ops-workspace.module.css";
export type RegistrationRow = {
  id: string;
  displayIgn: string;
  status: string;
  phoneLastFour: string | null;
  phoneIssue: string | null;
  ingestedAt: string;
  conflicts: {
    reason: string;
    existingMemberId: string | null;
    resolved: boolean;
  }[];
  decisions: { action: string; createdAt: string }[];
};
export function RegistrationWorkspace({
  rows,
  members,
}: {
  rows: RegistrationRow[];
  members: { value: string; label: string }[];
}) {
  const router = useRouter(),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const clean = rows.filter(
    (r) =>
      ["PENDING", "NEEDS_CLARIFICATION"].includes(r.status) &&
      !r.conflicts.some((c) => !c.resolved),
  );
  async function approve(ids: string[]) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await staffRequest("approveRegistrations", { ids });
      setSelected([]);
      setMessage(
        `Approved ${ids.length} registration${ids.length === 1 ? "" : "s"}.`,
      );
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to approve registrations.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.list}>
      {!!clean.length && (
        <div className={styles.toolbar}>
          <label className={styles.selection}>
            <input
              type="checkbox"
              checked={clean.every((r) => selected.includes(r.id))}
              disabled={busy}
              onChange={(e) =>
                setSelected(e.target.checked ? clean.map((r) => r.id) : [])
              }
            />
            Select registrations without conflicts
          </label>
          <button
            className="button small"
            disabled={busy || !selected.length}
            onClick={() => approve(selected)}
          >
            {busy ? "Approving…" : `Approve selected (${selected.length})`}
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {rows.map((r) => (
        <RegistrationItem
          key={r.id}
          row={r}
          members={members}
          busy={busy}
          selected={selected.includes(r.id)}
          select={(checked) =>
            setSelected(
              checked
                ? [...selected, r.id]
                : selected.filter((id) => id !== r.id),
            )
          }
          approve={() => approve([r.id])}
        />
      ))}
      {!rows.length && (
        <p className="empty">
          No registrations need review. Use the status filter to see past
          registrations.
        </p>
      )}
    </div>
  );
}
function RegistrationItem({
  row: r,
  members,
  busy,
  selected,
  select,
  approve,
}: {
  row: RegistrationRow;
  members: { value: string; label: string }[];
  busy: boolean;
  selected: boolean;
  select: (value: boolean) => void;
  approve: () => void;
}) {
  const [details, setDetails] = useState(false),
    [review, setReview] = useState(false);
  const conflicts = r.conflicts.filter((c) => !c.resolved),
    pending = ["PENDING", "NEEDS_CLARIFICATION"].includes(r.status);
  return (
    <article className={styles.item}>
      <div className={styles.row}>
        {pending && !conflicts.length && (
          <input
            type="checkbox"
            aria-label={`Select ${r.displayIgn}`}
            disabled={busy}
            checked={selected}
            onChange={(e) => select(e.target.checked)}
          />
        )}
        <span className={styles.name}>{r.displayIgn}</span>
        <span className={styles.status}>{friendlyLabel(r.status)}</span>
        <div className={styles.actions}>
          {pending && !conflicts.length && (
            <button className="button small" disabled={busy} onClick={approve}>
              Approve
            </button>
          )}
          <button
            className="button small secondary"
            onClick={() => setDetails(!details)}
          >
            {details ? "Hide details" : "View details"}
          </button>
          {r.status !== "APPROVED" && (
            <button
              className="button small secondary"
              onClick={() => setReview(!review)}
            >
              {conflicts.length ? "Resolve duplicate" : "Review"}
            </button>
          )}
        </div>
      </div>
      <p className={styles.meta}>
        {r.ingestedAt} · Phone{" "}
        {r.phoneLastFour ? `•••• ${r.phoneLastFour}` : "not supplied"}
        {r.phoneIssue === "INVALID_REQUIRES_REVIEW" ? " · Needs checking" : ""}
      </p>
      {conflicts.map((c, i) => (
        <p className="notice" key={i}>
          {c.reason}
          {c.existingMemberId && (
            <>
              {" "}
              · Existing member:{" "}
              {members.find((m) => m.value === c.existingMemberId)?.label ??
                "Member unavailable"}
            </>
          )}
        </p>
      ))}
      {details && <PrivateDetails kind="submission" id={r.id} autoLoad />}
      {review && (
        <div className={styles.editor}>
          <ActionForm
            action="review"
            fixed={{ id: r.id }}
            label="Save decision"
            fields={[
              {
                name: "action",
                label: "Decision",
                type: "select",
                required: true,
                options: [
                  { value: "APPROVE", label: "Approve" },
                  { value: "REJECT", label: "Reject" },
                  { value: "CLARIFY", label: "Needs clarification" },
                ],
              },
              ...(conflicts.length
                ? [
                    {
                      name: "memberId",
                      label: "Link to existing member",
                      type: "select" as const,
                      options: members,
                    },
                  ]
                : []),
              {
                name: "ign",
                label: "Corrected player name",
                value: r.displayIgn,
              },
              { name: "reason", label: "Note", type: "textarea" },
            ]}
          />
        </div>
      )}
      {!!r.decisions.length && (
        <details className="details">
          <summary>Past decisions ({r.decisions.length})</summary>
          {r.decisions.map((d, i) => (
            <p key={i} className={styles.meta}>
              {d.createdAt} · {friendlyLabel(d.action)}
            </p>
          ))}
        </details>
      )}
    </article>
  );
}
