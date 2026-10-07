import {
  friendlyLabel,
  activityLabel,
  activityDetails,
  configurationRows,
  ruleLabel,
  displayValue,
} from "@/lib/staff-presentation";
import { TournamentConfigForm } from "./tournament-config-form";
import { TournamentProgression } from "./tournament-progression";
import { FixtureBrowser } from "./fixture-browser";
import { MatchResultForm } from "./match-result-form";
import {
  configuration,
  newTournamentConfiguration,
} from "@/lib/tournament-config";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getActor } from "@/lib/auth";
import { privateTx, audit, type Actor, type Tx } from "@/lib/db";
import {
  ActionForm,
  UploadForm,
  PrivateDetails,
  AuditExport,
  type Field,
} from "./action-form";
import { Logout } from "./login-form";
import { Wordmark } from "./wordmark";
import { operationalTime } from "@/lib/public-data";
import type { Rules } from "@/lib/domain";
import { standingsFor, tournamentReadiness } from "@/lib/competition";
import { decrypt } from "@/lib/crypto";
const reason: Field = {
  name: "reason",
  label: "Reason for this change",
  required: true,
  placeholder: "Briefly explain your decision",
};
const nav = [
  ["overview", "Overview"],
  ["registrations", "Registration inbox"],
  ["members", "Members"],
  ["tournaments", "Tournaments & rules"],
  ["teams", "Team rosters"],
  ["matches", "Fixtures & results"],
  ["content", "Announcements"],
  ["imports", "Registration uploads"],
  ["audit", "Activity history"],
  ["settings", "Registration settings"],
  ["staff", "Staff accounts"],
];
export async function StaffDashboard({
  params,
  searchParams,
  area,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
  area: "admin" | "moderator";
}) {
  let actor: Actor;
  try {
    actor = await getActor();
  } catch {
    redirect("/login");
  }
  if (area === "admin" && actor.role !== "ADMIN") redirect("/moderator");
  const { path } = await params,
    query = await searchParams;
  const section = path?.[0] ?? "overview";
  if ((path && path.length > 1) || !nav.some(([key]) => key === section))
    notFound();
  if (["settings", "staff"].includes(section) && actor.role !== "ADMIN")
    redirect("/moderator");
  const base = actor.role === "ADMIN" ? "/admin" : "/moderator";
  const content = await privateTx(actor, async (tx) => {
    await audit(tx, actor, "STAFF_VIEW", "VIEW", section, {
      filterApplied: !!query.q,
      page: Number(query.page) || 1,
    });
    return renderSection(tx, actor, section, query, base);
  });
  return (
    <div className="wrap staff-layout">
      <aside className="sidebar">
        <div className="staff-meta mb-6">
          <Wordmark />
          <span className="badge">{friendlyLabel(actor.role)}</span>
          <p className="text-xs muted mt-3">
            Operations workspace
            <br />
            Malaysia time
          </p>
          <Logout />
        </div>
        <nav aria-label="Staff workspace">
          {nav
            .filter(
              ([key]) =>
                actor.role === "ADMIN" || !["settings", "staff"].includes(key),
            )
            .map(([key, label]) => (
              <Link
                key={key}
                className={key === section ? "active" : ""}
                href={`${base}${key === "overview" ? "" : `/${key}`}`}
              >
                {label}
              </Link>
            ))}
        </nav>
      </aside>
      <section className="staff-main">
        <div className="eyebrow">PAILANGZ operations</div>
        <h1>{nav.find(([key]) => key === section)?.[1]}</h1>
        {content}
      </section>
    </div>
  );
}
function Filter({ status = false }: { status?: boolean }) {
  return (
    <form className="filter" method="get">
      <label className="sr-only" htmlFor="search">
        Search
      </label>
      <input id="search" name="q" placeholder="Search by player name or code" />
      {status && (
        <>
          <label className="sr-only" htmlFor="status">
            Status
          </label>
          <select name="status" id="status">
            <option value="">All statuses</option>
            {["PENDING", "APPROVED", "REJECTED", "NEEDS_CLARIFICATION"].map(
              (s) => (
                <option key={s} value={s}>
                  {friendlyLabel(s)}
                </option>
              ),
            )}
          </select>
        </>
      )}
      <button className="button small secondary">Filter</button>
    </form>
  );
}
function Pagination({
  page,
  total,
  base,
  query,
}: {
  page: number;
  total: number;
  base: string;
  query: Record<string, string | undefined>;
}) {
  function url(n: number) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query))
      if (v && k !== "page") q.set(k, v);
    q.set("page", String(n));
    return `${base}?${q}`;
  }
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {total} records · page {page}
      </span>
      <div className="row">
        {page > 1 && <Link href={url(page - 1)}>← Previous</Link>}
        {page * 20 < total && <Link href={url(page + 1)}>Next →</Link>}
      </div>
    </nav>
  );
}
async function renderSection(
  tx: Tx,
  actor: Actor,
  section: string,
  q: Record<string, string | undefined>,
  base: string,
): Promise<React.ReactNode> {
  const page = Math.max(1, Math.min(10000, Number(q.page) || 1)),
    skip = (page - 1) * 20;
  const query = q.q?.slice(0, 100);
  if (section === "overview") {
    const [members, pending, tournaments, matches, stale] = await Promise.all([
      tx.member.count(),
      tx.registrationSubmission.count({ where: { status: "PENDING" } }),
      tx.tournament.count(),
      tx.match.count(),
      tx.bracketDependency.count({ where: { stale: true } }),
    ]);
    return (
      <div className="stack">
        <div className="grid3">
          {[
            ["Members", members],
            ["Pending reviews", pending],
            ["Draft / active tournaments", tournaments],
            ["Scheduled series", matches],
            ["Bracket changes needing review", stale],
          ].map(([label, n]) => (
            <div className="panel" key={label}>
              <p className="muted text-xs">{label}</p>
              <strong className="text-3xl">{n}</strong>
            </div>
          ))}
        </div>
        <div className="notice">
          Your tournament starts as a draft. Review the player list, approve
          registrations, and set the dates and rules before publishing.
        </div>
        <div className="grid2">
          <Link className="panel" href={`${base}/registrations`}>
            <h3>Review registrations ↗</h3>
            <p className="muted mb-0 text-sm">
              Upload registrations, check duplicate player names, and approve
              members.
            </p>
          </Link>
          <Link className="panel" href={`${base}/tournaments`}>
            <h3>Prepare the arena ↗</h3>
            <p className="muted mb-0 text-sm">
              Inspect readiness, confirm rules and preview all six rounds.
            </p>
          </Link>
        </div>
      </div>
    );
  }
  if (section === "registrations") {
    const memberChoices = (
      await tx.member.findMany({
        where: { archived: false },
        select: { id: true, displayIgn: true },
        orderBy: { displayIgn: "asc" },
      })
    ).map((m) => ({ value: m.id, label: m.displayIgn }));
    const status = [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "NEEDS_CLARIFICATION",
    ].includes(q.status ?? "")
      ? (q.status as
          "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_CLARIFICATION")
      : undefined;
    const where = {
      status,
      ...(query
        ? {
            OR: [
              { displayIgn: { contains: query, mode: "insensitive" as const } },
              { sourceResponseId: { contains: query } },
            ],
          }
        : {}),
    };
    const [rows, total, counts] = await Promise.all([
      tx.registrationSubmission.findMany({
        where,
        skip,
        take: 20,
        orderBy: { ingestedAt: "desc" },
        select: {
          id: true,
          displayIgn: true,
          source: true,
          sourceResponseId: true,
          ingestedAt: true,
          status: true,
          phoneLastFour: true,
          phoneIssue: true,
          conflicts: {
            select: { reason: true, existingMemberId: true, resolved: true },
          },
          decisions: {
            orderBy: { createdAt: "asc" },
            select: {
              action: true,
              reason: true,
              createdAt: true,
              actorId: true,
            },
          },
        },
      }),
      tx.registrationSubmission.count({ where }),
      tx.registrationSubmission.groupBy({ by: ["status"], _count: true }),
    ]);
    return (
      <div className="stack">
        <div className="row">
          {counts.map((c) => (
            <span key={c.status} className="badge neutral">
              {friendlyLabel(c.status)}: {c._count}
            </span>
          ))}
        </div>
        <div className="panel">
          <h3>Upload registrations</h3>
          <p className="muted text-sm">
            Upload the registration spreadsheet downloaded from Google Sheets.
            Automatic syncing is not connected yet. All answers stay private.
          </p>
          <UploadForm action="import" />
        </div>
        <div>
          <Filter status />
          {!rows.length && (
            <div className="empty">
              <strong>No registrations found.</strong> Try another search or
              upload your registration spreadsheet.
            </div>
          )}
          <div className="stack">
            {rows.map((r) => (
              <article className="panel" key={r.id}>
                <div className="row">
                  <h3 className="mb-0">{r.displayIgn}</h3>
                  <span className="badge neutral ml-auto">
                    {friendlyLabel(r.status)}
                  </span>
                </div>
                <p className="muted text-xs mt-3 break-all">
                  {friendlyLabel(r.source)} ·{operationalTime(r.ingestedAt)} ·
                  WhatsApp{" "}
                  {r.phoneLastFour ? `•••• ${r.phoneLastFour}` : "not supplied"}{" "}
                  {r.phoneIssue && `· ${friendlyLabel(r.phoneIssue)}`}
                </p>
                {r.conflicts
                  .filter((c) => !c.resolved)
                  .map((c, i) => (
                    <div className="notice" key={i}>
                      {c.reason}
                      {c.existingMemberId && (
                        <p className="text-xs break-all mb-0">
                          Existing member:{" "}
                          {memberChoices.find(
                            (m) => m.value === c.existingMemberId,
                          )?.label ?? "Review the member list"}
                        </p>
                      )}
                    </div>
                  ))}
                <details className="details">
                  <summary>Private registration details</summary>
                  <PrivateDetails kind="submission" id={r.id} />
                </details>
                {r.status !== "APPROVED" && (
                  <details className="details">
                    <summary>Review registration</summary>
                    <ActionForm
                      action="review"
                      fixed={{ id: r.id }}
                      label="Record decision"
                      fields={[
                        {
                          name: "action",
                          required: true,
                          label: "Decision",
                          type: "select",
                          options: [
                            { value: "APPROVE", label: "Approve membership" },
                            { value: "REJECT", label: "Reject" },
                            {
                              value: "CLARIFY",
                              label: "Request clarification",
                            },
                          ],
                        },
                        reason,
                        {
                          name: "memberId",
                          label: "Link to an existing member",
                          type: "select",
                          options: memberChoices,
                          help: "For a duplicate name, choose the matching member. Their existing registration details are protected.",
                        },
                        { name: "ign", label: "Corrected player name" },
                        {
                          name: "note",
                          label: "Internal note",
                          type: "textarea",
                        },
                      ]}
                    />
                  </details>
                )}
                <details className="details">
                  <summary>Past decisions ({r.decisions.length})</summary>
                  {r.decisions.map((d, i) => (
                    <p className="text-xs muted" key={i}>
                      {operationalTime(d.createdAt)} · {friendlyLabel(d.action)}{" "}
                      · {decrypt(d.reason, `decision:${r.id}`)}
                    </p>
                  ))}
                </details>
              </article>
            ))}
          </div>
          <Pagination
            page={page}
            total={total}
            base={`${base}/registrations`}
            query={q}
          />
        </div>
      </div>
    );
  }
  if (section === "members") {
    const where = query
      ? { displayIgn: { contains: query, mode: "insensitive" as const } }
      : {};
    const [rows, total] = await Promise.all([
      tx.member.findMany({
        where,
        skip,
        take: 20,
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
              tournamentId: true,
            },
          },
        },
      }),
      tx.member.count({ where }),
    ]);
    return (
      <>
        <Filter />
        <div className="stack">
          {rows.map((m) => (
            <article className="panel" key={m.id}>
              <div className="row">
                <h3 className="mb-0">{m.displayIgn}</h3>
                <span className={`badge ${m.verified ? "" : "warning"}`}>
                  {m.archived
                    ? "Archived"
                    : m.verified
                      ? "Approved"
                      : "Awaiting approval"}
                </span>
              </div>
              <p className="text-xs muted mt-3">
                WhatsApp:{" "}
                {m.privateData?.phoneLastFour
                  ? `•••• ${m.privateData.phoneLastFour}`
                  : "not supplied"}{" "}
                {m.privateData?.phoneIssue &&
                  `· ${friendlyLabel(m.privateData.phoneIssue)}`}
              </p>
              {m.privateData && (
                <details className="details">
                  <summary>Private registration details</summary>
                  <PrivateDetails kind="member" id={m.id} />
                </details>
              )}
              <details className="details">
                <summary>Update player name or archive</summary>
                <ActionForm
                  action="member"
                  fixed={{ id: m.id }}
                  fields={[
                    { name: "ign", label: "Player name", value: m.displayIgn },
                    reason,
                  ]}
                  label="Update player name"
                />
                <hr className="divider" />
                <ActionForm
                  action="member"
                  fixed={{ id: m.id, archived: !m.archived }}
                  fields={[reason]}
                  label={m.archived ? "Restore member" : "Archive member"}
                />
              </details>
              {m.participants.map((p) => (
                <details className="details" key={p.id}>
                  <summary>
                    {p.code} · {p.eligible ? "Eligible" : "Eligibility pending"}
                  </summary>
                  <ActionForm
                    action="participant"
                    fixed={{ id: p.id, eligible: !p.eligible }}
                    fields={[reason]}
                    label={
                      p.eligible
                        ? "Remove eligibility"
                        : "Confirm tournament eligibility"
                    }
                  />
                </details>
              ))}
            </article>
          ))}
        </div>
        <Pagination
          page={page}
          total={total}
          base={`${base}/members`}
          query={q}
        />
      </>
    );
  }
  if (section === "tournaments") {
    if (!q.id) {
      const rows = await tx.tournament.findMany({
        orderBy: { createdAt: "desc" },
      });
      return (
        <div className="stack">
          {rows.map((t) => (
            <Link
              className="panel"
              href={`${base}/tournaments?id=${t.id}`}
              key={t.id}
            >
              <span className="badge neutral">
                {friendlyLabel(t.status)} ·{" "}
                {t.published ? "Published" : "Private draft"}
              </span>
              <h3 className="mt-4">{t.name}</h3>
              <span className="text-link">Open setup & readiness ↗</span>
            </Link>
          ))}
          <details className="panel">
            <summary className="text-link cursor-pointer">
              Create tournament
            </summary>
            <ActionForm
              action="tournament"
              fixed={{ status: "DRAFT" }}
              fields={[
                { name: "name", label: "Name", required: true },

                {
                  name: "overview",
                  label: "Overview",
                  type: "textarea",
                  required: true,
                },
                {
                  name: "overviewEn",
                  label: "English overview",
                  type: "textarea",
                },
                {
                  name: "configuration",
                  label: "Tournament sizes",
                  type: "configuration",
                  value: newTournamentConfiguration,
                },
                reason,
              ]}
              label="Create draft"
            />
          </details>
        </div>
      );
    }
    const { t, checks } = await tournamentReadiness(tx, q.id);
    const stages = t.categories.flatMap((c) => c.stages);
    const config = configuration(t.configuration);
    const qualification = stages.find((s) => s.key === "qualification");
    const revisions = await tx.configurationRevision.findMany({
      where: { tournamentId: t.id },
      orderBy: { version: "desc" },
    });
    const approvedMembers = (
      await tx.member.findMany({
        where: { verified: true, archived: false },
        select: { id: true, displayIgn: true },
        orderBy: { displayIgn: "asc" },
      })
    ).map((m) => ({ value: m.id, label: m.displayIgn }));
    const rankingChoices = new Map<
      string,
      { value: string; label: string }[]
    >();
    for (const stage of stages)
      if (stage.format === "LEAGUE") {
        const { rows } = await standingsFor(tx, stage.id);
        rankingChoices.set(
          stage.id,
          rows.map((p) => ({
            value: p.id,
            label: `${p.code} · ${p.ign} · ${p.points} points${p.tied ? " · Tied" : ""}`,
          })),
        );
      }
    const snapshots = await tx.rankingSnapshot.findMany({
      where: { stageId: { in: stages.map((s) => s.id) }, stale: false },
      orderBy: { version: "desc" },
    });
    const leagueStage = stages.find((s) => s.key === "league");
    const leagueRanks = (snapshots.find((s) => s.stageId === leagueStage?.id)
      ?.rankings ?? []) as { id: string; code: string; ign: string }[];
    const playoffRanks = (snapshots.find((s) => s.stageId === qualification?.id)
      ?.rankings ?? []) as { id: string; code: string; ign: string }[];
    const toChoice = (p: { id: string; code: string; ign: string }) => ({
      value: p.id,
      label: `${p.code} · ${p.ign}`,
    });
    const playoffChoices = leagueRanks
      .slice(config.directSlots, config.directSlots + config.playoffEntrants)
      .map(toChoice);
    const qualifiedChoices = [
      ...leagueRanks.slice(0, config.directSlots),
      ...playoffRanks.slice(0, config.playoffSlots),
    ].map(toChoice);
    const teamChoices = new Map(
      t.categories.map((c) => [
        c.id,
        c.teams.map((team) => ({ value: team.id, label: team.name })),
      ]),
    );
    return (
      <div className="stack">
        <Link className="text-link" href={`${base}/tournaments`}>
          ← Tournaments
        </Link>
        <h2>{t.name}</h2>
        <details className="panel" open>
          <summary className="cursor-pointer text-link">
            Tournament presentation preview
          </summary>
          <div className="mt-5">
            <TournamentProgression
              configuration={config}
              planned={!t.published}
              qualificationBestOf={
                qualification?.confirmedRules.includes("qualificationBestOf")
                  ? (qualification.rules as Rules).qualificationBestOf
                  : null
              }
            />
          </div>
        </details>
        <details className="panel">
          <summary>
            Change tournament sizes · update {t.configurationVersion}
          </summary>
          <TournamentConfigForm id={t.id} configuration={config} />
        </details>
        {revisions.map((r) => (
          <details className="panel" key={r.id}>
            <summary>
              Tournament update {r.version} · {friendlyLabel(r.status)}
            </summary>
            <p>{decrypt(r.reasonEncrypted, `tournament:${t.id}`)}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Current</th>
                    <th>Proposed</th>
                  </tr>
                </thead>
                <tbody>
                  {configurationRows(r.configuration).map((row, i) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>
                        {configurationRows(r.beforeConfiguration)[i]?.value}
                      </td>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.status === "PENDING" && actor.role === "ADMIN" && (
              <>
                <div className="notice">
                  Applying a controlled restart retains previous matches,
                  scores, evidence and standings in archived stages. Previous
                  results will not count toward the new revision. Resolve
                  affected brackets by restarting stages and reconfirming rules;
                  no entrants are removed.
                </div>
                <ActionForm
                  action="revisionApply"
                  fixed={{
                    id: r.id,
                    acknowledgement: "RESTART_AND_RETAIN_HISTORY",
                  }}
                  fields={[
                    {
                      name: "confirmRestart",
                      label:
                        "I understand this restarts the competition. Previous results stay in history and will not count in the new competition.",
                      type: "checkbox",
                      required: true,
                    },
                    reason,
                  ]}
                  label="Restart competition with these sizes"
                />
                <ActionForm
                  action="revisionReject"
                  fixed={{ id: r.id }}
                  fields={[reason]}
                  label="Reject proposal"
                />
              </>
            )}
            {r.resolutionEncrypted && (
              <p>{decrypt(r.resolutionEncrypted, `revision:${r.id}`)}</p>
            )}
          </details>
        ))}
        <details className="panel">
          <summary>Choose players and create league matches</summary>
          <ActionForm
            action="assignParticipants"
            fixed={{ id: t.id }}
            fields={[
              {
                name: "memberIds",
                label: "Choose players to add",
                type: "members",
                options: approvedMembers.filter(
                  (m) => !t.participants.some((p) => p.memberId === m.value),
                ),
                max: Math.max(0, config.soloCapacity - t.participants.length),
                required: true,
                help: "Search by name and select approved members for this tournament.",
              },
              {
                name: "eligible",
                label: "Confirm these players can compete",
                type: "checkbox",
              },
              reason,
            ]}
            label="Assign SOLO entrants"
          />
          <hr className="divider" />
          <ActionForm
            action="generateLeague"
            fixed={{ id: t.id }}
            fields={[reason]}
            label="Create league matches"
          />
        </details>
        <div className="grid2">
          <div className="panel">
            <h3>
              Readiness · {checks.filter((c) => c.done).length}/{checks.length}
            </h3>
            <div className="checks">
              {checks.map((c) => (
                <div className={`check ${c.done ? "done" : ""}`} key={c.key}>
                  <span>{c.done ? "✓" : "○"}</span>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Overview & schedule</h3>
            <ActionForm
              action="tournament"
              fixed={{ id: t.id }}
              fields={[
                { name: "name", label: "Name", value: t.name, required: true },
                {
                  name: "overview",
                  label: "Overview",
                  type: "textarea",
                  value: t.overview,
                  required: true,
                },
                {
                  name: "gameTitle",
                  label: "Game title",
                  value: t.gameTitle ?? "",
                },
                {
                  name: "startsAt",
                  label: "Tournament starts",
                  type: "datetime-local",
                  value: t.startsAt?.toISOString() ?? "",
                },
                {
                  name: "registrationDeadline",
                  label: "Registration closes",
                  type: "datetime-local",
                  value: t.registrationDeadline?.toISOString() ?? "",
                },
                {
                  name: "status",
                  required: true,
                  label: "Tournament status",
                  type: "select",
                  value: t.status,
                  options: [
                    "DRAFT",
                    "REGISTRATION_OPEN",
                    "REGISTRATION_CLOSED",
                    "IN_PROGRESS",
                    "COMPLETED",
                    "ARCHIVED",
                  ].map((x) => ({ value: x, label: friendlyLabel(x) })),
                },
                {
                  name: "overviewEn",
                  label: "English overview",
                  type: "textarea",
                  value: t.overviewEn ?? "",
                },
                reason,
              ]}
            />
          </div>
        </div>
        {actor.role === "ADMIN" && (
          <div className="grid2">
            <div className="panel">
              <h3>Player list confirmation</h3>
              <p className="muted text-sm">
                Check that the player names and codes match your approved list.
                Approve registrations and confirm each player can compete before
                publishing.
              </p>
              <ActionForm
                action="mapping"
                fixed={{ id: t.id }}
                fields={[reason]}
                label="Confirm player list"
              />
            </div>
            <div className="panel">
              <h3>Publication</h3>
              <p className="muted text-sm">
                Publication is blocked until readiness is complete. Draft
                fixture previews are available in the staff workspace.
              </p>
              <ActionForm
                action="publish"
                fixed={{ id: t.id, published: !t.published }}
                fields={[reason]}
                label={t.published ? "Unpublish" : "Approve publication"}
              />
            </div>
          </div>
        )}
        <Link
          className="text-link"
          href={`${base}/matches?history=${q.history === "true" ? "false" : "true"}`}
        >
          {q.history === "true"
            ? "Show active stages"
            : "Show retained stage / result history"}
        </Link>
        {stages.map((s) => (
          <div className="panel" key={s.id}>
            <div className="row">
              <h3>{s.name}</h3>
              <span className="badge neutral ml-auto">
                Rules update {s.ruleVersion}
              </span>
            </div>
            <p className="muted text-sm">
              Confirmed:{" "}
              {s.confirmedRules.map(ruleLabel).join(", ") ||
                "No rules confirmed yet"}
            </p>
            <details className="details">
              <summary>
                Tournament rules{" "}
                {actor.role !== "ADMIN" && "· admin approval required"}
              </summary>
              {actor.role === "ADMIN" ? (
                <ActionForm
                  action="rules"
                  fixed={{ stageId: s.id }}
                  label="Save rules"
                  fields={[
                    {
                      name: "rules",
                      label: "Tournament rules",
                      type: "rules",
                      value: s.rules,
                      confirmed: s.confirmedRules,
                      stageKey: s.key,
                      kind: t.categories.find((c) => c.id === s.categoryId)
                        ?.kind,
                    },
                    reason,
                  ]}
                />
              ) : (
                <dl className="readable-details">
                  {Object.entries(s.rules as Record<string, unknown>).map(
                    ([key, value]) => (
                      <div key={key}>
                        <dt>{ruleLabel(key)}</dt>
                        <dd>
                          {displayValue(value)}
                          {s.confirmedRules.includes(key)
                            ? " · Confirmed"
                            : " · Awaiting confirmation"}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              )}
            </details>
            <details className="details">
              <summary>Stage progression</summary>
              {s.format === "LEAGUE" ? (
                <>
                  <ActionForm
                    action="freeze"
                    fixed={{ stageId: s.id }}
                    label="Save final rankings"
                    fields={[
                      {
                        name: "rankedIds",
                        label: "Final player rankings",
                        type: "ordered",
                        options: rankingChoices.get(s.id) ?? [],
                        value: (rankingChoices.get(s.id) ?? []).map(
                          (p) => p.value,
                        ),
                        complete: true,
                        min: (rankingChoices.get(s.id) ?? []).length,
                        required: true,
                        help: "The current standings appear below. Use the arrows to resolve tied players, then explain your decision. Points and confirmed tiebreakers still apply.",
                      },
                      reason,
                    ]}
                  />
                  {s.key === "qualification" && (
                    <>
                      <hr className="divider" />
                      <ActionForm
                        action="qualification"
                        fixed={{ stageId: s.id }}
                        label="Create qualification fixtures"
                        fields={[
                          {
                            name: "pairs",
                            label: "Choose playoff opponents",
                            type: "pairs",
                            pairCount:
                              (config.playoffEntrants *
                                config.qualificationMatchesPerPlayer) /
                              2,
                            matchesPerPlayer:
                              config.qualificationMatchesPerPlayer,
                            options: playoffChoices,
                            required: true,
                          },
                          reason,
                        ]}
                      />
                    </>
                  )}
                </>
              ) : (
                <ActionForm
                  action={
                    t.categories.find((c) => c.id === s.categoryId)?.kind ===
                    "SOLO"
                      ? "soloBracket"
                      : "teamBracket"
                  }
                  fixed={{ categoryId: s.categoryId }}
                  label="Create confirmed bracket"
                  fields={
                    t.categories.find((c) => c.id === s.categoryId)?.kind ===
                    "SOLO"
                      ? (s.rules as Rules).knockoutPairing === "manual"
                        ? [
                            {
                              name: "rankedIds",
                              label: "SOLO knockout starting order",
                              type: "ordered",
                              options: qualifiedChoices,
                              value: qualifiedChoices.map((p) => p.value),
                              complete: true,
                              min: config.directSlots + config.playoffSlots,
                              required: true,
                            },
                            reason,
                          ]
                        : [reason]
                      : [
                          {
                            name: "teamIds",
                            label: "Team starting order",
                            type: "ordered",
                            options: teamChoices.get(s.categoryId) ?? [],
                            value: (teamChoices.get(s.categoryId) ?? []).map(
                              (p) => p.value,
                            ),
                            complete: true,
                            min: config.teamCapacity,
                            required: true,
                          },
                          reason,
                        ]
                  }
                />
              )}
            </details>
          </div>
        ))}
        <Link
          className="button secondary"
          href={`${base}/matches?tournamentId=${t.id}`}
        >
          Preview fixtures & results ↗
        </Link>
      </div>
    );
  }
  if (section === "teams") {
    const approvedMembers = (
      await tx.member.findMany({
        where: { verified: true, archived: false },
        select: { id: true, displayIgn: true },
        orderBy: { displayIgn: "asc" },
      })
    ).map((m) => ({ value: m.id, label: m.displayIgn }));
    const categories = await tx.category.findMany({
      where: { kind: "TEAM" },
      include: {
        tournament: { select: { name: true } },
        teams: {
          include: {
            memberships: {
              where: { active: true },
              include: { member: { select: { displayIgn: true } } },
            },
          },
        },
      },
    });
    return (
      <div className="stack">
        {categories.map((c) => (
          <div key={c.id}>
            <h3>{c.tournament.name}</h3>
            <p className="muted text-sm">
              Exactly four approved players per team. Players may belong to only
              one active team in this category.
            </p>
            <div className="team-slots">
              {Array.from({ length: c.capacity }, (_, i) => {
                const t = c.teams.filter((t) => !t.archived)[i];
                return (
                  <div className="slot" key={i}>
                    <strong>{t?.name ?? `Empty team slot ${i + 1}`}</strong>
                    {t?.memberships.map((m) => (
                      <div key={m.id}>{m.member.displayIgn}</div>
                    ))}
                    {!t && <span>No roster assigned</span>}
                  </div>
                );
              })}
            </div>
            <details className="panel">
              <summary>Create a team</summary>
              <ActionForm
                action="team"
                fixed={{ categoryId: c.id }}
                label="Create team"
                fields={[
                  { name: "name", label: "Team name", required: true },
                  {
                    name: "memberIds",
                    label: "Choose team players",
                    type: "members",
                    max: 4,
                    options: approvedMembers.map((m) => ({
                      ...m,
                      disabled: c.teams.some(
                        (t) =>
                          !t.archived &&
                          t.memberships.some((p) => p.memberId === m.value),
                      ),
                    })),
                    help: "Choose up to four approved players. A complete team needs four players. Names already on another team are unavailable.",
                  },
                  reason,
                ]}
              />
            </details>
            <div className="stack">
              {c.teams.map((team) => (
                <details className="panel" key={team.id}>
                  <summary>
                    {team.name} ·{" "}
                    {team.archived
                      ? "Archived"
                      : `${team.memberships.length}/4 players`}
                  </summary>
                  <ActionForm
                    action="team"
                    fixed={{ categoryId: c.id, id: team.id }}
                    label="Save team"
                    fields={[
                      {
                        name: "name",
                        label: "Team name",
                        required: true,
                        value: team.name,
                      },
                      {
                        name: "memberIds",
                        label: "Team players",
                        type: "members",
                        value: team.memberships.map((m) => m.memberId),
                        max: 4,
                        options: approvedMembers.map((m) => ({
                          ...m,
                          disabled: c.teams.some(
                            (t) =>
                              t.id !== team.id &&
                              !t.archived &&
                              t.memberships.some((p) => p.memberId === m.value),
                          ),
                        })),
                        help: "Search by name to add players. Remove a selected name using the × button.",
                      },
                      {
                        name: "archived",
                        label: "Archive this team",
                        type: "checkbox",
                        value: team.archived,
                      },
                      reason,
                    ]}
                  />
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (section === "matches") {
    const stages = await tx.stage.findMany({
      where: {
        ...(q.tournamentId
          ? { category: { tournamentId: q.tournamentId } }
          : {}),
        ...(q.history === "true" ? {} : { archived: false }),
      },
      include: {
        category: { include: { tournament: { select: { name: true } } } },
        rounds: {
          orderBy: { number: "asc" },
          include: {
            matches: {
              orderBy: { order: "asc" },
              include: {
                results: {
                  orderBy: { version: "desc" },
                  include: {
                    games: { orderBy: { number: "asc" } },
                    evidence: { select: { id: true, mime: true } },
                  },
                },
                dependencies: { where: { stale: true } },
                disputes: { orderBy: { createdAt: "asc" } },
              },
            },
          },
        },
      },
    });
    const stageStandings = new Map<
      string,
      Awaited<ReturnType<typeof standingsFor>>["rows"]
    >();
    for (const stage of stages)
      if (stage.format === "LEAGUE")
        stageStandings.set(
          stage.id,
          stage.archived
            ? ((stage.archivedStandings ?? []) as Awaited<
                ReturnType<typeof standingsFor>
              >["rows"])
            : (await standingsFor(tx, stage.id)).rows,
        );
    const participants = await tx.participant.findMany({
        include: { member: { select: { displayIgn: true } } },
      }),
      teams = await tx.team.findMany({
        select: { id: true, name: true, categoryId: true },
      });
    const names = new Map([
      ...participants.map(
        (p) => [p.id, `${p.code} · ${p.member.displayIgn}`] as const,
      ),
      ...teams.map((t) => [t.id, t.name] as const),
    ]);
    return (
      <div className="stack">
        <Link
          className="text-link"
          href={`${base}/matches?${q.tournamentId ? `tournamentId=${encodeURIComponent(q.tournamentId)}&` : ""}history=${q.history === "true" ? "false" : "true"}`}
        >
          {q.history === "true"
            ? "Show current stages"
            : "Include retained competition history"}
        </Link>
        {stages.map((s) => {
          const opponentChoices =
            s.category.kind === "SOLO"
              ? participants
                  .filter((p) => p.tournamentId === s.category.tournamentId)
                  .map((p) => ({
                    value: p.id,
                    label: `${p.code} · ${p.member.displayIgn}`,
                  }))
              : teams
                  .filter((t) => t.categoryId === s.categoryId)
                  .map((t) => ({ value: t.id, label: t.name }));
          return (
            <div key={s.id}>
              <h3>
                {s.category.tournament.name} · {s.name}
              </h3>
              {s.archived && (
                <div className="notice">
                  Retained history · scores and evidence remain available. This
                  stage is read only and does not count in the current revision.
                </div>
              )}
              {s.format === "LEAGUE" && (
                <details className="details">
                  <summary>
                    Current standings · tied players need a decision
                  </summary>
                  <Standings rows={stageStandings.get(s.id) ?? []} />
                </details>
              )}
              {!s.rounds.length && (
                <div className="empty">
                  Fixtures await confirmed rules and participants.
                </div>
              )}
              {s.format === "LEAGUE" && s.rounds.length > 0 && (
                <details className="panel mb-4" open>
                  <summary className="cursor-pointer text-link">
                    Visual fixture preview
                  </summary>
                  <div className="mt-5">
                    <FixtureBrowser
                      title={s.name}
                      draft
                      rounds={s.rounds.map((r) => ({
                        number: r.number,
                        name: r.name,
                        matches: r.matches.map((m) => {
                          const result = m.results.find(
                            (result) =>
                              result.id === m.currentResultId &&
                              result.status === "ACCEPTED",
                          );
                          return {
                            id: m.id,
                            a: names.get(m.sideAId ?? "") ?? "Menunggu peserta",
                            b:
                              m.status === "BYE"
                                ? "Rest round"
                                : (names.get(m.sideBId ?? "") ??
                                  "Menunggu peserta"),
                            bestOf: m.bestOf,
                            status: m.status,
                            scheduledAt: m.scheduledAt,
                            result:
                              m.status === "FINALIZED" && result
                                ? {
                                    outcome: result.outcome,
                                    games: result.games.map((g) => ({
                                      number: g.number,
                                      scoreA: g.scoreA,
                                      scoreB: g.scoreB,
                                    })),
                                  }
                                : null,
                          };
                        }),
                      }))}
                    />
                  </div>
                </details>
              )}
              {s.rounds.map((r) => (
                <details
                  className="panel mb-4"
                  key={r.id}
                  open={q.round === String(r.number)}
                >
                  <summary className="cursor-pointer text-lime">
                    {r.name} · {r.matches.length} series
                  </summary>
                  <div className="stack mt-5">
                    {r.matches.map((m) => (
                      <article key={m.id} className="panel">
                        <fieldset
                          disabled={s.archived}
                          className="border-0 p-0 m-0 min-w-0"
                        >
                          <div className="row">
                            <strong>
                              {names.get(m.sideAId ?? "") ?? "Pending"}{" "}
                              <span className="muted mx-3">VS</span>{" "}
                              {m.status === "BYE"
                                ? "Rest round"
                                : (names.get(m.sideBId ?? "") ?? "Pending")}
                            </strong>
                            <span className="badge neutral ml-auto">
                              Best of {m.bestOf} · {friendlyLabel(m.status)}
                            </span>
                          </div>
                          <p className="muted text-xs break-all mt-3">
                            Match {m.order}
                          </p>
                          {m.dependencies.map((d) => (
                            <div className="notice" key={d.id}>
                              An earlier result changed. Review the opponents
                              before continuing.
                              {actor.role === "ADMIN" && (
                                <ActionForm
                                  action="dependency"
                                  fixed={{ id: d.id }}
                                  fields={[
                                    reason,
                                    {
                                      name: "sideAId",
                                      label: "Replace first opponent",
                                      type: "select",
                                      options: opponentChoices,
                                    },
                                    {
                                      name: "sideBId",
                                      label: "Replace second opponent",
                                      type: "select",
                                      options: opponentChoices,
                                    },
                                  ]}
                                  label="Confirm opponents"
                                />
                              )}
                            </div>
                          ))}
                          <details className="details">
                            <summary>Submit / correct result</summary>
                            <MatchResultForm
                              matchId={m.id}
                              bestOf={m.bestOf}
                              sideA={names.get(m.sideAId ?? "") ?? "Player A"}
                              sideB={names.get(m.sideBId ?? "") ?? "Player B"}
                              rules={s.rules as Rules}
                              confirmedRules={s.confirmedRules}
                              initialResult={
                                m.results.find(
                                  (v) => v.id === m.currentResultId,
                                ) ?? m.results[0]
                              }
                              blockedReason={
                                s.archived
                                  ? "This match is retained history and cannot be edited."
                                  : m.status === "BYE"
                                    ? "This is a bye; there are no game scores to enter."
                                    : m.status === "VOIDED"
                                      ? "This match has been voided and cannot receive a result."
                                      : !m.sideAId || !m.sideBId
                                        ? "Both opponents must be assigned before entering a result."
                                        : m.dependencies.length
                                          ? "An admin needs to resolve the bracket changes before this result can be submitted."
                                          : undefined
                              }
                            />
                          </details>
                          {m.results.map((v) => (
                            <details key={v.id} className="details">
                              <summary>
                                Result {v.version} · {friendlyLabel(v.outcome)}{" "}
                                · {friendlyLabel(v.status)}
                              </summary>
                              <p className="muted text-xs">
                                {operationalTime(v.createdAt)} ·{" "}
                                {v.games
                                  .map((g) => `${g.scoreA}–${g.scoreB}`)
                                  .join(" / ")}
                              </p>
                              {v.evidence.map((e) => (
                                <a
                                  key={e.id}
                                  className="text-link block mb-3"
                                  href={`/api/staff?evidence=${e.id}`}
                                >
                                  Download private evidence ↗
                                </a>
                              ))}
                              {v.status === "ACCEPTED" &&
                                m.currentResultId === v.id && (
                                  <ActionForm
                                    action="resultReview"
                                    fixed={{ id: v.id, action: "DISPUTE" }}
                                    fields={[reason]}
                                    label="Open a dispute"
                                  />
                                )}
                              {v.status === "SUBMITTED" && (
                                <>
                                  <UploadForm
                                    action="evidence"
                                    resultId={v.id}
                                  />
                                  <hr className="divider" />
                                  <ActionForm
                                    action="resultReview"
                                    fixed={{ id: v.id }}
                                    fields={[
                                      {
                                        name: "action",
                                        required: true,
                                        label: "Decision",
                                        type: "select",
                                        options: [
                                          "ACCEPT",
                                          "REJECT",
                                          "DISPUTE",
                                        ].map((x) => ({
                                          value: x,
                                          label: friendlyLabel(x),
                                        })),
                                      },
                                      reason,
                                    ]}
                                    label="Record result decision"
                                  />
                                </>
                              )}
                            </details>
                          ))}
                          {m.disputes.map((d) => (
                            <div className="notice" key={d.id}>
                              <strong>
                                {d.resolved
                                  ? "Resolved dispute"
                                  : "Open dispute"}
                              </strong>
                              <p>
                                {decrypt(d.reasonEncrypted, `match:${m.id}`)}
                              </p>
                              {d.resolved ? (
                                <p>
                                  {d.resolutionEncrypted
                                    ? decrypt(
                                        d.resolutionEncrypted,
                                        `dispute:${d.id}`,
                                      )
                                    : "—"}
                                </p>
                              ) : (
                                <ActionForm
                                  action="disputeResolve"
                                  fixed={{ id: d.id }}
                                  fields={[
                                    {
                                      name: "uphold",
                                      label:
                                        "Keep the accepted result (leave unchecked to cancel the match)",
                                      type: "checkbox",
                                    },
                                    reason,
                                  ]}
                                  label="Resolve dispute"
                                />
                              )}
                            </div>
                          ))}
                          <details className="details">
                            <summary>Match schedule and actions</summary>
                            <ActionForm
                              action="match"
                              fixed={{ id: m.id }}
                              fields={[
                                {
                                  name: "scheduledAt",
                                  label: "Match date and time",
                                  type: "datetime-local",
                                  value: m.scheduledAt?.toISOString() ?? "",
                                },
                                reason,
                              ]}
                              label="Save schedule"
                            />
                            <hr className="divider" />
                            <ActionForm
                              action="match"
                              fixed={{
                                id: m.id,
                                status:
                                  m.status === "SCHEDULED"
                                    ? "IN_PROGRESS"
                                    : "VOIDED",
                              }}
                              fields={[reason]}
                              label={
                                m.status === "SCHEDULED"
                                  ? "Start match"
                                  : "Cancel match"
                              }
                            />
                            {s.format === "KNOCKOUT" && (
                              <>
                                <hr className="divider" />
                                <ActionForm
                                  action="advance"
                                  fixed={{ matchId: m.id }}
                                  fields={[reason]}
                                  label={
                                    m.status === "BYE"
                                      ? "Advance player without an opponent"
                                      : "Advance confirmed winner"
                                  }
                                />
                              </>
                            )}
                          </details>
                        </fieldset>
                      </article>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          );
        })}
      </div>
    );
  }
  if (section === "content") {
    const rows = await tx.announcement.findMany({
      orderBy: { createdAt: "desc" },
    });
    return (
      <div className="stack">
        <div className="panel">
          <h3>Create announcement</h3>
          <ActionForm
            action="announcement"
            fields={[
              { name: "title", label: "Title", required: true },
              {
                name: "body",
                label: "Bahasa Melayu copy",
                type: "textarea",
                required: true,
              },
              {
                name: "published",
                label: "Publish (admin approval)",
                type: "checkbox",
              },
              { name: "titleEn", label: "English title" },
              {
                name: "bodyEn",
                label: "English announcement",
                type: "textarea",
              },
              reason,
            ]}
          />
        </div>
        {rows.map((r) => (
          <details className="panel" key={r.id}>
            <summary>
              {r.title} · {r.published ? "Published" : "Draft"}
            </summary>
            <ActionForm
              action="announcement"
              fixed={{ id: r.id }}
              fields={[
                {
                  name: "title",
                  label: "Title",
                  value: r.title,
                  required: true,
                },
                {
                  name: "body",
                  label: "Body",
                  type: "textarea",
                  value: r.body,
                  required: true,
                },
                {
                  name: "published",
                  label: "Published",
                  type: "checkbox",
                  value: r.published,
                },
                {
                  name: "archived",
                  label: "Archived",
                  type: "checkbox",
                  value: r.archived,
                },
                {
                  name: "titleEn",
                  label: "English title",
                  value: r.titleEn ?? "",
                },
                {
                  name: "bodyEn",
                  label: "English announcement",
                  type: "textarea",
                  value: r.bodyEn ?? "",
                },
                reason,
              ]}
            />
          </details>
        ))}
      </div>
    );
  }
  if (section === "imports") {
    const [rows, total] = await Promise.all([
      tx.importJob.findMany({
        skip,
        take: 20,
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { submissions: true } } },
      }),
      tx.importJob.count(),
    ]);
    return (
      <>
        <div className="panel mb-6">
          <UploadForm action="import" />
          <p className="muted text-xs mt-4">
            Registrations are added to the review inbox. Previously uploaded
            answers are skipped, and duplicate names are flagged for review.
          </p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Uploaded · Malaysia time</th>
                <th>Answers / new registrations</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{friendlyLabel(r.source)}</td>
                  <td>{operationalTime(r.createdAt)}</td>
                  <td>
                    {r.rowCount} / {r._count.submissions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          total={total}
          base={`${base}/imports`}
          query={q}
        />
      </>
    );
  }
  if (section === "audit") {
    const staffNames = new Map(
      (await tx.staffUser.findMany({ select: { id: true, name: true } })).map(
        (u) => [u.id, u.name],
      ),
    );
    const where = {
      ...(actor.role === "MODERATOR"
        ? { entityType: { notIn: ["STAFF", "SECURITY", "SETTING"] } }
        : {}),
      ...(query
        ? {
            OR: [
              { action: { contains: query, mode: "insensitive" as const } },
              {
                actorId: {
                  in: [...staffNames]
                    .filter(([, name]) =>
                      name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map(([id]) => id),
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      tx.auditEvent.findMany({
        where,
        skip,
        take: 20,
        orderBy: { createdAt: "desc" },
      }),
      tx.auditEvent.count({ where }),
    ]);
    return (
      <>
        <Filter />
        <details className="panel">
          <summary>Download activity history</summary>
          <AuditExport />
        </details>
        <div className="notice">
          Every activity is recorded here and cannot be changed or deleted.
          Times are shown in Malaysia time. Private information stays hidden.
        </div>
        <div className="stack">
          {rows.map((e) => (
            <details className="panel" key={e.id}>
              <summary className="cursor-pointer text-sm">
                {operationalTime(e.createdAt)} · {activityLabel(e.action)}{" "}
                <span className="badge neutral ml-2">
                  {friendlyLabel(e.outcome)}
                </span>
              </summary>
              <p className="muted text-xs mt-4">
                By{" "}
                {staffNames.get(e.actorId ?? "") ?? friendlyLabel(e.actorRole)}{" "}
                · {friendlyLabel(e.entityType)}
                {e.reason && (
                  <>
                    <br />
                    {e.reason}
                  </>
                )}
              </p>
              <dl className="readable-details">
                {activityDetails(e.changes).map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
        </div>
        <Pagination
          page={page}
          total={total}
          base={`${base}/audit`}
          query={q}
        />
      </>
    );
  }
  if (section === "settings") {
    const settings = await tx.integrationSetting.findMany({
      where: { key: { in: ["formMapping", "responderUrl"] } },
    });
    return (
      <div className="stack">
        <div className="notice">
          Automatic syncing with Google Sheets is not connected yet. Download
          your responses as a spreadsheet and upload them in the registration
          inbox.
        </div>
        <div className="grid2">
          <div className="panel">
            <h3>Public registration link</h3>
            <ActionForm
              action="setting"
              fixed={{ key: "responderUrl" }}
              fields={[
                {
                  name: "value",
                  label: "Google Form link for players",
                  type: "url",
                  help: "Paste the link players use to fill in the form, from the Send button in Google Forms.",
                  value:
                    (settings.find((s) => s.key === "responderUrl")
                      ?.value as string) ?? "",
                  required: true,
                },
                reason,
              ]}
            />
          </div>
          <div className="panel">
            <h3>Registration spreadsheet columns</h3>
            <ActionForm
              action="setting"
              fixed={{ key: "formMapping" }}
              fields={[
                {
                  name: "value",
                  label: "Spreadsheet columns",
                  type: "mapping",
                  value: settings.find((s) => s.key === "formMapping")
                    ?.value ?? {
                    ign: "IGN",
                    phone: "Whatsapp Number",
                    country: "Country",
                  },
                },
                reason,
              ]}
            />
          </div>
        </div>
        <div className="panel">
          <h3>Private member downloads</h3>
          <p className="muted text-sm">
            Downloading private member information is currently unavailable.
            Contact the person managing this site if you need access.
          </p>
        </div>
      </div>
    );
  }
  if (section === "staff") {
    const users = await tx.staffUser.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        suspended: true,
      },
      orderBy: { createdAt: "asc" },
    });
    return (
      <div className="stack">
        <div className="notice">
          To add a staff account, contact the person managing this site. You can
          change existing staff permissions below.
        </div>
        {users.map((u) => (
          <div className="panel" key={u.id}>
            <h3>{u.name}</h3>
            <p className="muted text-sm">
              {u.email} · {friendlyLabel(u.role)} ·{" "}
              {u.suspended ? "Suspended" : "Active"}
            </p>
            {u.id !== actor.id && (
              <ActionForm
                action="staff"
                fixed={{ id: u.id }}
                fields={[
                  {
                    name: "role",
                    required: true,
                    label: "Role",
                    type: "select",
                    value: u.role,
                    options: ["ADMIN", "MODERATOR"].map((x) => ({
                      value: x,
                      label: friendlyLabel(x),
                    })),
                  },
                  {
                    name: "suspended",
                    label: "Suspended",
                    type: "checkbox",
                    value: u.suspended,
                  },
                  reason,
                ]}
                label="Save permissions and sign out this staff member"
              />
            )}
          </div>
        ))}
      </div>
    );
  }
  return null;
}
function Standings({
  rows,
}: {
  rows: Awaited<ReturnType<typeof standingsFor>>["rows"];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Played</th>
            <th>Wins / draws / losses</th>
            <th>Points</th>
            <th>Games won / lost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.rank ?? "Unresolved tie"}</td>
              <td>
                {r.code} · {r.ign}
              </td>
              <td>{r.played}</td>
              <td>
                {r.wins}/{r.draws}/{r.losses}
              </td>
              <td>{r.points}</td>
              <td>
                {r.gameWins}/{r.gameLosses}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
