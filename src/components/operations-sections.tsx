import Link from "next/link";
import type { Actor, Tx } from "@/lib/db";
import { MemberWorkspace } from "./member-workspace";
import { RegistrationWorkspace } from "./registration-workspace";
import { UploadForm } from "./action-form";
import { operationalTime } from "@/lib/public-data";
export { renderActivityHistory } from "./activity-history";
type Query = Record<string, string | undefined>;
function pageNumber(q: Query) {
  return Math.max(1, Math.min(10000, Number(q.page) || 1));
}
export function SectionPages({
  q,
  total,
  base,
  size = 50,
}: {
  q: Query;
  total: number;
  base: string;
  size?: number;
}) {
  const page = pageNumber(q);
  function url(n: number) {
    const params = new URLSearchParams(
      Object.entries(q).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    params.set("page", String(n));
    return `${base}?${params}`;
  }
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {total} records · page {page}
      </span>
      <div className="row">
        {page > 1 && <Link href={url(page - 1)}>← Previous</Link>}
        {page * size < total && <Link href={url(page + 1)}>Next →</Link>}
      </div>
    </nav>
  );
}
export async function renderMembers(
  tx: Tx,
  _actor: Actor,
  q: Query,
  base: string,
) {
  const state = q.state ?? "active",
    search = q.q?.slice(0, 100);
  const where = {
    ...(state === "archived"
      ? { archived: true }
      : state === "all"
        ? {}
        : { archived: false }),
    ...(state === "pending" ? { verified: false } : {}),
    ...(search
      ? {
          OR: [
            { displayIgn: { contains: search, mode: "insensitive" as const } },
            {
              participants: {
                some: {
                  code: { contains: search, mode: "insensitive" as const },
                },
              },
            },
            { privateData: { phoneLastFour: { contains: search } } },
          ],
        }
      : {}),
  };
  const [members, total] = await Promise.all([
    tx.member.findMany({
      where,
      skip: (pageNumber(q) - 1) * 50,
      take: 50,
      orderBy: { displayIgn: "asc" },
      select: {
        id: true,
        displayIgn: true,
        verified: true,
        archived: true,
        privateData: { select: { phoneLastFour: true, phoneIssue: true } },
        participants: {
          select: {
            id: true,
            code: true,
            eligible: true,
            tournament: { select: { name: true, published: true } },
          },
        },
      },
    }),
    tx.member.count({ where }),
  ]);
  return (
    <div className="stack">
      <MemberWorkspace
        key={search ?? state}
        members={members}
        initialQuery={search ?? ""}
        state={state}
        basePath={`${base}/members`}
        total={total}
      />
      <SectionPages q={q} total={total} base={`${base}/members`} />
    </div>
  );
}
export async function renderRegistrations(
  tx: Tx,
  _actor: Actor,
  q: Query,
  base: string,
) {
  const status = q.status ?? "review",
    search = q.q?.slice(0, 100);
  const statuses = [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "NEEDS_CLARIFICATION",
  ] as const;
  const parsed = statuses.find((s) => s === status);
  const where = {
    ...(parsed
      ? { status: parsed }
      : status === "all"
        ? {}
        : {
            status: {
              in: ["PENDING", "NEEDS_CLARIFICATION"] as (
                "PENDING" | "NEEDS_CLARIFICATION"
              )[],
            },
          }),
    ...(search
      ? { displayIgn: { contains: search, mode: "insensitive" as const } }
      : {}),
  };
  const [rows, total, members] = await Promise.all([
    tx.registrationSubmission.findMany({
      where,
      skip: (pageNumber(q) - 1) * 50,
      take: 50,
      orderBy: { ingestedAt: "desc" },
      select: {
        id: true,
        displayIgn: true,
        status: true,
        phoneLastFour: true,
        phoneIssue: true,
        ingestedAt: true,
        conflicts: {
          select: { reason: true, existingMemberId: true, resolved: true },
        },
        decisions: {
          orderBy: { createdAt: "desc" },
          select: { action: true, createdAt: true },
        },
      },
    }),
    tx.registrationSubmission.count({ where }),
    tx.member.findMany({
      where: { archived: false },
      orderBy: { displayIgn: "asc" },
      select: { id: true, displayIgn: true },
    }),
  ]);
  return (
    <div className="stack">
      <form className="filter" method="get">
        <label className="sr-only" htmlFor="registration-search">
          Search registrations
        </label>
        <input
          id="registration-search"
          name="q"
          defaultValue={search}
          placeholder="Search player name"
        />
        <label className="sr-only" htmlFor="registration-status">
          Registration status
        </label>
        <select id="registration-status" name="status" defaultValue={status}>
          <option value="review">Needs review</option>
          <option value="all">All registrations</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s === "NEEDS_CLARIFICATION"
                ? "Needs clarification"
                : s[0] + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <button className="button small secondary">Filter</button>
      </form>
      <RegistrationWorkspace
        rows={rows.map((r) => ({
          ...r,
          ingestedAt: operationalTime(r.ingestedAt),
          decisions: r.decisions.map((d) => ({
            ...d,
            createdAt: operationalTime(d.createdAt),
          })),
        }))}
        members={members.map((m) => ({ value: m.id, label: m.displayIgn }))}
      />
      <SectionPages q={q} total={total} base={`${base}/registrations`} />
      <details className="panel">
        <summary>Upload registrations</summary>
        <p className="muted text-sm">
          Upload the CSV downloaded from your registration spreadsheet.
        </p>
        <UploadForm action="import" />
        <Link className="text-link" href={`${base}/imports`}>
          View import history ↗
        </Link>
      </details>
    </div>
  );
}
