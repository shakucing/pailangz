"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { staffRequest } from "@/lib/staff-request";
import { privateFieldLabel, friendlyError } from "@/lib/staff-presentation";
import styles from "./ops-workspace.module.css";

export type MemberRow = {
  id: string;
  displayIgn: string;
  verified: boolean;
  archived: boolean;
  privateData: {
    phoneLastFour: string | null;
    phoneIssue: string | null;
  } | null;
  participants: {
    id: string;
    code: string;
    eligible: boolean;
    tournament: { name: string; published: boolean };
  }[];
};
type Details = {
  fields: Record<string, string>;
  phone: string | null;
  editableFields?: string[];
};
export function MemberWorkspace({
  members,
  initialQuery = "",
  state = "active",
  basePath = "/admin/members",
  total = members.length,
}: {
  members: MemberRow[];
  initialQuery?: string;
  state?: string;
  basePath?: string;
  total?: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  function searchAll(nextState = state, nextQuery = query) {
    const params = new URLSearchParams({ state: nextState });
    if (nextQuery) params.set("q", nextQuery);
    router.push(`${basePath}?${params}`);
  }
  const rows = members.filter((m) =>
    [
      m.displayIgn,
      m.privateData?.phoneLastFour,
      ...m.participants.map((p) => p.code),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          searchAll();
        }}
      >
        <input
          className={styles.search}
          aria-label="Search members"
          placeholder="Search name, player code or last four phone digits"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Member status"
          value={state}
          onChange={(e) => searchAll(e.target.value)}
        >
          <option value="active">Active members</option>
          <option value="pending">Awaiting approval</option>
          <option value="archived">Archived members</option>
          <option value="all">All members</option>
        </select>
        {total > members.length && (
          <button className="button small secondary" type="submit">
            Search all
          </button>
        )}
        {initialQuery && (
          <button
            className="button small secondary"
            type="button"
            onClick={() => searchAll(state, "")}
          >
            Clear search
          </button>
        )}
        <span className="muted text-sm">{rows.length} members</span>
      </form>
      <div className={styles.list}>
        {rows.map((member) => (
          <MemberItem key={member.id} member={member} />
        ))}
      </div>
      {!rows.length && <p className="empty">No members match this search.</p>}
    </div>
  );
}
function MemberItem({ member }: { member: MemberRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false),
    [details, setDetails] = useState<Details | null>(null),
    [phone, setPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function run(action: string, data: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await staffRequest(action, data);
      setMessage("Saved");
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function edit() {
    if (editing) {
      setEditing(false);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const d = member.privateData
        ? await staffRequest<Details>("privateDetails", {
            kind: "member",
            id: member.id,
          })
        : { fields: {}, phone: null };
      setDetails(d);
      setPhone(d.phone);
      setEditing(true);
    } catch (e) {
      setError(
        friendlyError(
          e instanceof Error ? e.message : "Unable to load member.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={styles.item}>
      <div className={styles.row}>
        <span className={styles.name}>{member.displayIgn}</span>
        <span className={styles.status}>
          {member.archived
            ? "Archived"
            : member.verified
              ? "Approved"
              : "Awaiting approval"}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className="button small secondary"
            disabled={busy}
            onClick={edit}
          >
            {editing ? "Close" : "Edit member"}
          </button>
          <button
            type="button"
            className="button small secondary"
            disabled={busy}
            onClick={async () => {
              if (
                !member.archived &&
                !window.confirm(
                  `Archive ${member.displayIgn}? You can restore them later.`,
                )
              )
                return;
              await run("member", {
                id: member.id,
                archived: !member.archived,
              });
            }}
          >
            {member.archived ? "Restore" : "Archive"}
          </button>
        </div>
      </div>
      <div className={styles.contact}>
        {phone === null ? (
          <>
            <span className="text-sm muted">
              Phone:{" "}
              {member.privateData?.phoneLastFour
                ? `•••• ${member.privateData.phoneLastFour}`
                : "Not supplied"}
            </span>
            {member.privateData?.phoneLastFour && (
              <button
                className="button small secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const d = await staffRequest<{ phone: string | null }>(
                      "reveal",
                      { kind: "member", id: member.id },
                    );
                    setPhone(d.phone ?? "No phone supplied");
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Unable to load phone.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Show phone
              </button>
            )}
          </>
        ) : (
          <>
            <span>{phone}</span>
            <button
              type="button"
              className="button small secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(phone);
                  setMessage("Phone copied");
                } catch {
                  setError(
                    "Copy is unavailable. Select the number to copy it.",
                  );
                }
              }}
            >
              Copy phone
            </button>
            <button
              className="button small secondary"
              onClick={() => {
                setPhone(null);
                setDetails(null);
                setEditing(false);
              }}
            >
              Hide
            </button>
          </>
        )}
        {member.privateData?.phoneIssue === "INVALID_REQUIRES_REVIEW" && (
          <span className="text-sm muted">Needs checking</span>
        )}
      </div>
      {member.participants.map((p) => (
        <div className={styles.row} key={p.id}>
          <span className={styles.meta}>
            {p.code} · {p.tournament.name} ·{" "}
            {p.eligible ? "Eligible" : "Eligibility pending"}
          </span>
          <button
            className="button small secondary"
            disabled={busy || p.tournament.published}
            onClick={() =>
              run("participant", { id: p.id, eligible: !p.eligible })
            }
          >
            {p.eligible ? "Remove eligibility" : "Confirm eligibility"}
          </button>
          {p.tournament.published && (
            <span className="muted text-xs">Roster locked while published</span>
          )}
        </div>
      ))}
      {editing && details && (
        <form
          className={styles.editor}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const ign = String(form.get("ign") ?? "").trim(),
              nextPhone = String(form.get("phone") ?? "");
            const registrationFields = Object.fromEntries(
              Object.entries(details.fields)
                .filter(
                  ([k]) => details.editableFields?.includes(k) ?? editable(k),
                )
                .map(([k, v]) => [k, String(form.get(`field:${k}`) ?? v)])
                .filter(([k, v]) => details.fields[k] !== v),
            );
            const saved = await run("member", {
              id: member.id,
              ...(ign !== member.displayIgn ? { ign } : {}),
              ...(nextPhone !== (details.phone ?? "")
                ? { phone: nextPhone }
                : {}),
              registrationFields,
            });
            if (saved) {
              setEditing(false);
              setDetails(null);
              setPhone(nextPhone || null);
            }
          }}
        >
          <div className={styles.fields}>
            <label>
              Player name
              <input
                name="ign"
                defaultValue={member.displayIgn}
                required
                maxLength={80}
              />
            </label>
            <label>
              WhatsApp / phone
              <input
                name="phone"
                type="tel"
                defaultValue={details.phone ?? ""}
                maxLength={80}
              />
            </label>
            {Object.entries(details.fields)
              .filter(
                ([key]) =>
                  details.editableFields?.includes(key) ?? editable(key),
              )
              .map(([key, value]) => (
                <label key={key}>
                  {privateFieldLabel(key)}
                  <input
                    name={`field:${key}`}
                    defaultValue={String(value ?? "")}
                    maxLength={3000}
                  />
                </label>
              ))}
          </div>
          <div className={styles.actions}>
            <button className="button small" disabled={busy}>
              {busy ? "Saving…" : "Save member"}
            </button>
            <button
              type="button"
              className="button small secondary"
              onClick={() => {
                setEditing(false);
                setDetails(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
function editable(key: string) {
  return (
    !/^(timestamp|ign|response[_ ]?id|__proto__|constructor|prototype)$/i.test(
      key,
    ) && !/phone|whatsapp/i.test(key)
  );
}
