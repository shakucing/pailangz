"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, PrivateDetails } from "./action-form";
import { staffRequest } from "@/lib/staff-request";
import { friendlyLabel } from "@/lib/staff-presentation";
import styles from "./ops-workspace.module.css";
import { WorkspaceDialog } from "./workspace-dialog";
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
  const selectedIds = selected.filter((id) => clean.some((r) => r.id === id));
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        selectedIds.length > 0 && selectedIds.length < clean.length;
  }, [selectedIds.length, clean.length]);
  async function approve(ids: string[]) {
    if (busy || !ids.length) return;
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
              ref={selectAll}
              type="checkbox"
              checked={clean.every((r) => selected.includes(r.id))}
              disabled={busy}
              onChange={(e) =>
                setSelected(e.target.checked ? clean.map((r) => r.id) : [])
              }
            />
            Select eligible registrations on this page
          </label>
          <button
            className="button small"
            disabled={busy || !selectedIds.length}
            onClick={() => approve(selectedIds)}
          >
            {busy ? "Approving…" : `Approve selected (${selectedIds.length})`}
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
          reviewed={() => setMessage(`Decision saved for ${r.displayIgn}.`)}
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
  reviewed,
}: {
  row: RegistrationRow;
  members: { value: string; label: string }[];
  busy: boolean;
  selected: boolean;
  select: (value: boolean) => void;
  approve: () => void;
  reviewed: () => void;
}) {
  const [review, setReview] = useState(false);
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
            aria-haspopup="dialog"
            disabled={busy}
            onClick={() => setReview(true)}
          >
            {r.status === "APPROVED"
              ? "View details"
              : conflicts.length
                ? "Resolve duplicate"
                : "Review registration"}
          </button>
        </div>
      </div>
      <p className={styles.meta}>
        {r.ingestedAt} · Phone{" "}
        {r.phoneLastFour ? `•••• ${r.phoneLastFour}` : "not supplied"}
        {r.phoneIssue === "INVALID_REQUIRES_REVIEW" ? " · Needs checking" : ""}
      </p>
      {!!conflicts.length && (
        <p className={styles.meta}>
          {conflicts.length} duplicate check{conflicts.length === 1 ? "" : "s"}{" "}
          to resolve
        </p>
      )}
      {review && (
        <WorkspaceDialog
          title={`${r.status === "APPROVED" ? "Registration details" : "Review registration"} · ${r.displayIgn}`}
          description={`${friendlyLabel(r.status)} · Received ${r.ingestedAt}`}
          onClose={() => setReview(false)}
        >
          {conflicts.map((c, i) => (
            <p className="notice" key={i}>
              {c.reason}
              {c.existingMemberId &&
                ` · Existing member: ${members.find((m) => m.value === c.existingMemberId)?.label ?? "Member unavailable"}`}
            </p>
          ))}
          <div className={styles.reviewGrid}>
            <section>
              <h3>Player details</h3>
              <PrivateDetails kind="submission" id={r.id} autoLoad />
              {!!r.decisions.length && (
                <section className={styles.editor}>
                  <h3>Past decisions</h3>
                  {r.decisions.map((d, i) => (
                    <p key={i} className={styles.meta}>
                      {d.createdAt} · {friendlyLabel(d.action)}
                    </p>
                  ))}
                </section>
              )}
            </section>
            {r.status !== "APPROVED" && (
              <section>
                <h3>Review decision</h3>
                <ActionForm
                  action="review"
                  onSuccess={() => {
                    reviewed();
                    setReview(false);
                  }}
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
              </section>
            )}
          </div>
        </WorkspaceDialog>
      )}
    </article>
  );
}
