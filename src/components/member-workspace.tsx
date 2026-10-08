"use client";
import { useId, useState, useTransition } from "react";
import {
  Archive,
  ArrowDownAZ,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  LockKeyhole,
  Pencil,
  RotateCcw,
  Search,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { staffRequest } from "@/lib/staff-request";
import { privateFieldLabel, friendlyError } from "@/lib/staff-presentation";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import {
  memberFieldKind,
  memberFieldOptions,
  normalizeMemberField,
} from "@/lib/member-fields";
import styles from "./ops-workspace.module.css";
import { WorkspaceDialog } from "./workspace-dialog";
import tableStyles from "./member-workspace.module.css";

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
  countryField?: string;
};
export function MemberWorkspace({
  members,
  initialQuery = "",
  state = "active",
  country = "",
  basePath = "/admin/members",
  total = members.length,
}: {
  members: MemberRow[];
  initialQuery?: string;
  state?: string;
  country?: string;
  basePath?: string;
  total?: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [searching, startSearch] = useTransition();
  const searchId = useId();
  const countryLabel =
    country === "unspecified"
      ? "Country not specified"
      : COUNTRY_OPTIONS.find((option) => option.value === country)?.label;
  function searchAll(
    nextState = state,
    nextQuery = query,
    nextCountry = country,
  ) {
    const params = new URLSearchParams({ state: nextState });
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextCountry) params.set("country", nextCountry);
    startSearch(() => router.push(`${basePath}?${params}`, { scroll: false }));
  }
  return (
    <div className={tableStyles.workspace}>
      <form
        className={tableStyles.toolbar}
        role="search"
        aria-label="Search members"
        aria-busy={searching}
        onSubmit={(e) => {
          e.preventDefault();
          searchAll();
        }}
      >
        <label className={tableStyles.search} htmlFor={`${searchId}-query`}>
          Search all members
          <span className={tableStyles.searchInput}>
            <Search size={18} aria-hidden="true" />
            <input
              id={`${searchId}-query`}
              type="search"
              name="q"
              placeholder="Name, player code or last 4 phone digits"
              maxLength={100}
              value={query}
              disabled={searching}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
        </label>
        <label className={tableStyles.filter}>
          Member status
          <select
            value={state}
            disabled={searching}
            onChange={(e) => searchAll(e.target.value)}
          >
            <option value="active">Active members</option>
            <option value="pending">Awaiting approval</option>
            <option value="archived">Archived members</option>
            <option value="all">All members</option>
          </select>
        </label>
        <label className={tableStyles.filter} htmlFor={`${searchId}-country`}>
          Country
          <select
            id={`${searchId}-country`}
            name="country"
            value={country}
            disabled={searching}
            onChange={(e) => searchAll(state, query, e.target.value)}
          >
            <option value="">All countries</option>
            <option value="unspecified">Not specified</option>
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button small" type="submit" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
        {(query || initialQuery) && (
          <button
            className="button small secondary"
            type="button"
            disabled={searching}
            onClick={() => {
              setQuery("");
              searchAll(state, "");
            }}
          >
            Clear search
          </button>
        )}
      </form>
      <div className={tableStyles.summary}>
        <p role="status" aria-live="polite">
          {searching ? (
            "Updating members…"
          ) : (
            <>
              Showing <strong>{members.length}</strong> of{" "}
              <strong>{total}</strong> member{total === 1 ? "" : "s"}
              {initialQuery && <> matching “{initialQuery}”</>}
              {countryLabel && <> · {countryLabel}</>}
            </>
          )}
        </p>
        <span>
          <ArrowDownAZ size={16} aria-hidden="true" /> Sorted by name
        </span>
      </div>
      <p className={tableStyles.scrollHint} id={`${searchId}-hint`}>
        Scroll sideways to see all columns and actions.
      </p>
      <div
        className={tableStyles.tableScroll}
        role="region"
        aria-label="Member directory"
        tabIndex={0}
        aria-busy={searching}
      >
        <table className={tableStyles.table} role="table">
          <caption className="sr-only">
            Members, approval status, contact details and tournament entries
          </caption>
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Status</th>
              <th scope="col">Phone</th>
              <th scope="col">Tournament entries</th>
              <th scope="col" className={tableStyles.actionsHeading}>
                Actions
              </th>
            </tr>
          </thead>
          {members.map((member) => (
            <MemberItem key={member.id} member={member} />
          ))}
          {!members.length && (
            <tbody className={tableStyles.emptyGroup} role="rowgroup">
              <tr role="row">
                <td colSpan={5}>
                  <div className={tableStyles.empty}>
                    <Users size={28} aria-hidden="true" />
                    <strong>No members found</strong>
                    <p>
                      Try another name, player code, member status or country.
                    </p>
                    {(initialQuery || state !== "active" || country) && (
                      <button
                        type="button"
                        className="button small secondary"
                        disabled={searching}
                        onClick={() => {
                          setQuery("");
                          searchAll("active", "", "");
                        }}
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}

function MemberItem({ member }: { member: MemberRow }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const entriesId = useId();
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
    setEditing(true);
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
      setDirty(false);
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
  const pendingEntries = member.participants.filter((p) => !p.eligible).length;
  const status = member.archived
    ? "Archived"
    : member.verified
      ? "Approved"
      : "Awaiting approval";
  return (
    <tbody className={tableStyles.memberGroup} role="rowgroup">
      <tr
        role="row"
        className={tableStyles.memberRow}
        data-expanded={expanded || undefined}
      >
        <th scope="row" role="rowheader" className={tableStyles.memberName}>
          <span>{member.displayIgn}</span>
          <small>
            {member.participants.map((p) => p.code).join(" · ") ||
              "No player code"}
          </small>
        </th>
        <td role="cell" className={tableStyles.statusCell}>
          <span
            className={`${tableStyles.badge} ${member.archived ? tableStyles.archived : member.verified ? tableStyles.approved : tableStyles.pending}`}
          >
            {member.verified && !member.archived ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <span className={tableStyles.dot} aria-hidden="true" />
            )}
            {status}
          </span>
        </td>
        <td role="cell" className={tableStyles.contactCell}>
          <span className={tableStyles.mobileLabel} aria-hidden="true">
            Phone
          </span>
          <div className={tableStyles.phone}>
            <span>
              {phone ??
                (member.privateData?.phoneLastFour
                  ? `•••• ${member.privateData.phoneLastFour}`
                  : "Not supplied")}
            </span>
            {phone === null ? (
              member.privateData?.phoneLastFour && (
                <button
                  type="button"
                  className={tableStyles.iconButton}
                  aria-label={`Show phone for ${member.displayIgn}`}
                  title="Show phone"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    setMessage("");
                    try {
                      const d = await staffRequest<{ phone: string | null }>(
                        "reveal",
                        { kind: "member", id: member.id },
                      );
                      setPhone(d.phone ?? "No phone supplied");
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Unable to load phone.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Eye size={16} aria-hidden="true" />
                </button>
              )
            ) : (
              <span className={tableStyles.phoneActions}>
                <button
                  type="button"
                  className={tableStyles.iconButton}
                  aria-label={`Copy phone for ${member.displayIgn}`}
                  title="Copy phone"
                  onClick={async () => {
                    setError("");
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
                  <Copy size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={tableStyles.iconButton}
                  aria-label={`Hide phone for ${member.displayIgn}`}
                  title="Hide phone"
                  onClick={() => setPhone(null)}
                >
                  <EyeOff size={16} aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
          {member.privateData?.phoneIssue === "INVALID_REQUIRES_REVIEW" && (
            <small className={tableStyles.review}>Needs checking</small>
          )}
        </td>
        <td role="cell" className={tableStyles.entriesCell}>
          <span className={tableStyles.mobileLabel} aria-hidden="true">
            Tournament entries
          </span>
          {member.participants.length ? (
            <button
              type="button"
              className={tableStyles.entriesToggle}
              aria-label={`Tournament entries for ${member.displayIgn}`}
              aria-expanded={expanded}
              aria-controls={entriesId}
              onClick={() => setExpanded(!expanded)}
            >
              <span>
                <strong>
                  {member.participants.length}{" "}
                  {member.participants.length === 1 ? "entry" : "entries"}
                </strong>
                <small
                  className={pendingEntries ? tableStyles.review : undefined}
                >
                  {pendingEntries
                    ? `${pendingEntries} awaiting eligibility`
                    : "All entries eligible"}
                </small>
              </span>
              {expanded ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronRight size={16} aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className={tableStyles.noEntries}>No entries</span>
          )}
        </td>
        <td role="cell" className={tableStyles.actionsCell}>
          <div className={tableStyles.rowActions}>
            <button
              type="button"
              className={`button small secondary ${tableStyles.editButton}`}
              disabled={busy}
              aria-haspopup="dialog"
              aria-label={`Edit member · ${member.displayIgn}`}
              onClick={edit}
            >
              <Pencil size={14} aria-hidden="true" /> Edit
              <span className={tableStyles.mobileText}> member</span>
            </button>
            <button
              type="button"
              className={`${tableStyles.iconButton} ${tableStyles.archiveButton}`}
              disabled={busy}
              aria-label={`${member.archived ? "Restore" : "Archive"} ${member.displayIgn}`}
              title={member.archived ? "Restore member" : "Archive member"}
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
              {member.archived ? (
                <RotateCcw size={17} aria-hidden="true" />
              ) : (
                <Archive size={17} aria-hidden="true" />
              )}
              <span className={tableStyles.mobileText}>
                {member.archived ? "Restore" : "Archive"}
              </span>
            </button>
          </div>
          {busy && !editing && (
            <p className={tableStyles.feedback} role="status">
              Updating…
            </p>
          )}
          {message && (
            <p
              className={`${tableStyles.feedback} ${styles.success}`}
              role="status"
            >
              {message}
            </p>
          )}
          {error && !editing && (
            <p
              className={`${tableStyles.feedback} ${styles.error}`}
              role="alert"
            >
              {error}
            </p>
          )}
          {editing && (
            <WorkspaceDialog
              title={`Edit member · ${member.displayIgn}`}
              description="Update player details, then save to return to the member list."
              busy={busy}
              dirty={dirty}
              onClose={() => {
                setEditing(false);
                setDetails(null);
                setError("");
              }}
            >
              {details ? (
                <form
                  className="form"
                  onChange={() => setDirty(true)}
                  aria-busy={busy}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const ign = String(form.get("ign") ?? "").trim(),
                      nextPhone = String(form.get("phone") ?? "");
                    const registrationFields = Object.fromEntries(
                      Object.entries(details.fields)
                        .filter(
                          ([k]) =>
                            details.editableFields?.includes(k) ?? editable(k),
                        )
                        .map(([k, v]) => [
                          k,
                          String(form.get(`field:${k}`) ?? v),
                        ])
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
                      if (phone !== null) setPhone(nextPhone || null);
                    }
                  }}
                >
                  <fieldset
                    className={`form-fields ${styles.fields}`}
                    disabled={busy}
                  >
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
                          details.editableFields?.includes(key) ??
                          editable(key),
                      )
                      .map(([key, value]) => (
                        <MemberRegistrationField
                          key={key}
                          field={key}
                          value={String(value ?? "")}
                          countryField={details.countryField}
                        />
                      ))}
                  </fieldset>
                  <div className={styles.actions}>
                    <button className="button small" disabled={busy}>
                      {busy ? "Saving…" : "Save member"}
                    </button>
                  </div>
                </form>
              ) : busy ? (
                <p role="status">Loading member details…</p>
              ) : (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={edit}
                >
                  Retry loading details
                </button>
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </WorkspaceDialog>
          )}
        </td>
      </tr>
      {member.participants.length > 0 && (
        <tr
          id={entriesId}
          role="row"
          hidden={!expanded}
          className={tableStyles.expandedRow}
        >
          <td colSpan={5} role="cell">
            <div className={tableStyles.entriesPanel}>
              <h3>Tournament entries · {member.displayIgn}</h3>
              <ul>
                {member.participants.map((p) => (
                  <li key={p.id}>
                    <div className={tableStyles.entryName}>
                      <span className={tableStyles.code}>{p.code}</span>
                      <strong>{p.tournament.name}</strong>
                    </div>
                    <span
                      className={`${tableStyles.badge} ${p.eligible ? tableStyles.approved : tableStyles.pending}`}
                    >
                      {p.eligible ? "Eligible" : "Eligibility pending"}
                    </span>
                    <button
                      type="button"
                      className="button small secondary"
                      disabled={busy || p.tournament.published}
                      aria-describedby={
                        p.tournament.published
                          ? `${entriesId}-${p.id}-locked`
                          : undefined
                      }
                      onClick={() =>
                        run("participant", { id: p.id, eligible: !p.eligible })
                      }
                    >
                      {p.eligible
                        ? "Remove eligibility"
                        : "Confirm eligibility"}
                    </button>
                    {p.tournament.published && (
                      <span
                        id={`${entriesId}-${p.id}-locked`}
                        className={tableStyles.locked}
                      >
                        <LockKeyhole size={13} aria-hidden="true" /> Roster
                        locked while published
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

function MemberRegistrationField({
  field,
  value,
  countryField,
}: {
  field: string;
  value: string;
  countryField?: string;
}) {
  const helpId = useId();
  const kind = memberFieldKind(field, countryField);
  const legacy = kind && normalizeMemberField(kind, value) === undefined;
  const help = [
    legacy ? "Keep the saved value or select a replacement from the list." : "",
    kind === "status"
      ? "Registration record only. Approval, archiving and tournament eligibility are managed separately."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <label>
      {kind === "country"
        ? "Country"
        : kind === "status"
          ? "Status"
          : privateFieldLabel(field)}
      {kind ? (
        <select
          name={`field:${field}`}
          defaultValue={value}
          aria-describedby={help ? helpId : undefined}
        >
          {memberFieldOptions(kind, value).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input name={`field:${field}`} defaultValue={value} maxLength={3000} />
      )}
      {help && <small id={helpId}>{help}</small>}
    </label>
  );
}

function editable(key: string) {
  return (
    !/^(timestamp|ign|response[_ ]?id|__proto__|constructor|prototype)$/i.test(
      key,
    ) && !/phone|whatsapp/i.test(key)
  );
}
