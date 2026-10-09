import { TaskDialog, TaskDialogButton } from "./workspace-dialog";
import { TeamRosterForm } from "./team-roster-form";
import { TeamAvatar } from "./team-avatar";
import {
  friendlyLabel,
  activityLabel,
  activityDetails,
  configurationRows,
  ruleLabel,
  displayValue,
} from "@/lib/staff-presentation";
import { TournamentConfigForm } from "./tournament-config-form";
import { TournamentWorkspace } from "./tournament-workspace";
import { TournamentPlayerList } from "./tournament-player-list";
import { TournamentProgression } from "./tournament-progression";
import { FixtureBrowser } from "./fixture-browser";
import { FixtureStageFields } from "./fixture-stage-fields";
import { MatchResultForm } from "./match-result-form";
import {
  configuration,
  newTournamentConfiguration,
} from "@/lib/tournament-config";
import Link from "next/link";
import Form from "next/form";
import { Suspense } from "react";
import { headers } from "next/headers";
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
import { operationalTime } from "@/lib/public-data";
import type { Rules } from "@/lib/domain";
import { standingsFor, tournamentReadiness } from "@/lib/competition";
import { decrypt } from "@/lib/crypto";
import { DomainError } from "@/lib/domain";
import { StaffLoading } from "./staff-loading";
import { renderParticipation } from "./participation-workspace";
import { AddStaffAccount, StaffAccountRow } from "./staff-accounts-panel";
import {
  renderMembers,
  renderRegistrations,
  renderActivityHistory,
} from "./operations-sections";
const reason: Field = {
  name: "reason",
  label: "Note",
  placeholder: "Add a note if useful",
};
const requiredReason: Field = {
  name: "reason",
  label: "Reason for this decision",
  required: true,
  placeholder: "Explain the override or correction",
};
import { staffNavigation as nav } from "@/lib/staff-navigation";
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
  } catch (e) {
    if (e instanceof DomainError && [401, 403].includes(e.status))
      redirect("/staff");
    throw e;
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
  return (
    <>
      <div className="eyebrow">PAILANGZ operations</div>
      <h1>{nav.find(([key]) => key === section)?.[1]}</h1>
      <Suspense
        key={`${section}:${JSON.stringify(query)}`}
        fallback={<StaffLoading />}
      >
        <SectionContent
          actor={actor}
          section={section}
          query={query}
          base={base}
        />
      </Suspense>
    </>
  );
}
async function SectionContent({
  actor,
  section,
  query,
  base,
}: {
  actor: Actor;
  section: string;
  query: Record<string, string | undefined>;
  base: string;
}) {
  const requestHeaders = await headers();
  const prefetch =
    requestHeaders.has("next-router-prefetch") ||
    requestHeaders.get("purpose") === "prefetch";
  return privateTx(actor, async (tx) => {
    if (!prefetch)
      await audit(tx, actor, "STAFF_VIEW", "VIEW", section, {
        filterApplied: !!query.q,
        page: Number(query.page) || 1,
      });
    return renderSection(tx, actor, section, query, base);
  });
}
function Filter({ status = false }: { status?: boolean }) {
  return (
    <Form className="filter" action="">
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
    </Form>
  );
}
function Pagination({
  page,
  total,
  base,
  query,
  size = 20,
}: {
  page: number;
  total: number;
  base: string;
  query: Record<string, string | undefined>;
  size?: number;
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
        {page * size < total && <Link href={url(page + 1)}>Next →</Link>}
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
  if (section === "registrations")
    return renderRegistrations(tx, actor, q, base);
  if (section === "participation") return renderParticipation(tx, q, base);
  if (section === "members") return renderMembers(tx, actor, q, base);
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
          <TaskDialog label="Create tournament" title="Create tournament">
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
          </TaskDialog>
        </div>
      );
    }
    const { t, checks } = await tournamentReadiness(tx, q.id);
    const stages = t.categories.flatMap((c) => c.stages);
    const config = configuration(t.configuration);
    const remainingPlayerPlaces = Math.max(
      0,
      config.soloCapacity - t.participants.length,
    );
    const teamCategory = t.categories.find(
      (category) => category.kind === "TEAM",
    );
    const teamToReview =
      teamCategory?.teams.find(
        (team) =>
          team.memberships.length !== 4 ||
          team.memberships.some(
            (membership) =>
              !membership.member.verified || membership.member.archived,
          ),
      ) ??
      (teamCategory && teamCategory.teams.length >= config.teamCapacity
        ? teamCategory.teams[0]
        : undefined);
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
    const populatedStages = new Set(
      (
        await tx.round.findMany({
          where: {
            stageId: { in: stages.map((s) => s.id) },
            matches: { some: {} },
          },
          select: { stageId: true },
        })
      ).map((r) => r.stageId),
    );
    for (const stage of stages)
      if (stage.format === "LEAGUE" && populatedStages.has(stage.id)) {
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
    const ruleStage = (key: string) => {
      if (key.startsWith("qualification")) return qualification;
      if (key === "knockoutPairing" || key === "teamSeeding")
        return t.categories
          .find((c) => c.kind === (key === "teamSeeding" ? "TEAM" : "SOLO"))
          ?.stages.find((s) => s.key === "knockout");
      if (key === "byes")
        return stages.find((s) => {
          const affected =
            s.key === "league"
              ? config.soloCapacity % 2 !== 0
              : s.key === "knockout" &&
                (t.categories.find((c) => c.id === s.categoryId)?.kind ===
                "TEAM"
                  ? config.teamCapacity < config.teamBracketSize
                  : config.directSlots + config.playoffSlots <
                    config.soloBracketSize);
          return (
            affected &&
            (!s.confirmedRules.includes("byePolicy") ||
              (s.rules as Rules).byePolicy !==
                (s.key === "league"
                  ? config.leagueByePolicy
                  : config.bracketByePolicy))
          );
        });
      return leagueStage;
    };
    const readinessAction = (check: (typeof checks)[number]) => {
      const target =
        check.key === "teams"
          ? "tournament-teams"
          : check.key === "mapping"
            ? "player-list-confirmation"
            : check.key === "eligibility"
              ? remainingPlayerPlaces > 0
                ? "tournament-players"
                : "tournament-eligibility"
              : check.key === "schedule"
                ? "tournament-players"
                : ["dates", "gameTitle"].includes(check.key)
                  ? "tournament-overview"
                  : `tournament-rules-${(ruleStage(check.key) ?? stages[0]).id}`;
      const fieldTarget =
        check.key === "teams"
          ? teamToReview
            ? 'input[type="search"]'
            : '[name="name"]'
          : check.key === "mapping"
            ? '[data-action="mapping"] button[type="submit"]'
            : check.key === "eligibility"
              ? remainingPlayerPlaces > 0
                ? 'input[type="search"]'
                : '[aria-label="Select all assigned players"]'
              : check.key === "schedule"
                ? '[data-action="generateLeague"] button[type="submit"]'
                : check.key === "dates"
                  ? `[name="${t.startsAt ? "registrationDeadline" : "startsAt"}"]`
                  : check.key === "gameTitle"
                    ? '[name="gameTitle"]'
                    : `[name="rule:${check.key === "byes" ? "byePolicy" : check.key}"]`;
      return (
        <TaskDialogButton target={target} fieldTarget={fieldTarget}>
          {check.label}
        </TaskDialogButton>
      );
    };
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
        <div className="panel tournament-summary">
          <div>
            <h3>
              {friendlyLabel(t.status)} ·{" "}
              {t.published ? "Public" : "Private draft"}
            </h3>
            <p className="muted text-sm">
              {t.participants.length}/{config.soloCapacity} players ·{" "}
              {
                t.categories
                  .flatMap((c) => c.teams)
                  .filter((team) => !team.archived).length
              }
              /{config.teamCapacity} teams · Sizes update{" "}
              {t.configurationVersion}
            </p>
          </div>
          <div className="actions">
            <Link
              className="button secondary"
              href={`${base}/matches?tournamentId=${t.id}`}
            >
              View fixtures & results ↗
            </Link>
          </div>
        </div>
        <TournamentWorkspace
          readiness={
            <>
              {" "}
              <div className="panel">
                <h3>
                  Ready to publish · {checks.filter((c) => c.done).length}/
                  {checks.length}
                </h3>
                <progress
                  className="readiness-meter"
                  aria-label="Tournament readiness"
                  value={checks.filter((c) => c.done).length}
                  max={checks.length}
                />
                <p className="muted text-sm">
                  {checks.length - checks.filter((c) => c.done).length} items
                  still need attention.
                </p>
                <div className="checks">
                  {checks
                    .filter((c) => !c.done)
                    .slice(0, 3)
                    .map((c) => (
                      <div className="check" key={c.key}>
                        <span>○</span>
                        {readinessAction(c)}
                      </div>
                    ))}
                </div>
                <details>
                  <summary>View readiness checklist</summary>
                  <div className="checks">
                    {checks.map((c) => (
                      <div
                        className={`check ${c.done ? "done" : ""}`}
                        key={c.key}
                      >
                        <span>{c.done ? "✓" : "○"}</span>
                        {readinessAction(c)}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </>
          }
          overview={
            <>
              {" "}
              <div className="panel" id="tournament-registration-links">
                <h3>SOLO &amp; TEAM registration links</h3>
                <p className="muted text-sm">
                  {t.registrationEnabled ? "Links enabled" : "Links disabled"} ·
                  One player registration for SOLO &amp; TEAM.
                  {!t.registrationEnabled &&
                    " Enable player registration in Overview & schedule to make these pages available."}
                </p>
                <div className="actions">
                  <Link
                    className="button secondary"
                    href={`/participate/${t.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Player registration ↗
                  </Link>
                </div>
                <p className="muted text-sm mt-4 mb-0">
                  Share /participate/{t.slug} with players. Enabled registration
                  also appears on the landing page for its featured event.
                  Player entry closes at the deadline, when all{" "}
                  {config.soloCapacity} places are filled, or when registration
                  closes or the tournament is published.
                </p>
              </div>
              <div className="panel">
                <h3>Overview & schedule</h3>
                <p className="muted text-sm">
                  Dates use Malaysia time. Registration can open before fixtures
                  and results are public.
                </p>
                <dl className="tournament-dates">
                  <div>
                    <dt>Game</dt>
                    <dd>{t.gameTitle || "Not set"}</dd>
                  </div>
                  <div>
                    <dt>Tournament starts</dt>
                    <dd>
                      {t.startsAt ? operationalTime(t.startsAt) : "Not set"}
                    </dd>
                  </div>
                  <div>
                    <dt>Registration closes</dt>
                    <dd>
                      {t.registrationDeadline
                        ? operationalTime(t.registrationDeadline)
                        : "Not set"}
                    </dd>
                  </div>
                </dl>
                <TaskDialog
                  id="tournament-overview"
                  label="Edit overview & schedule"
                  title={`Overview & schedule · ${t.name}`}
                >
                  <ActionForm
                    action="tournament"
                    fixed={{ id: t.id }}
                    fields={[
                      {
                        name: "name",
                        label: "Name",
                        value: t.name,
                        required: true,
                      },
                      {
                        name: "overview",
                        label: "Overview",
                        type: "textarea",
                        value: t.overview,
                        required: true,
                      },
                      {
                        name: "registrationEnabled",
                        label:
                          "Enable player registration and shareable team pages",
                        type: "checkbox",
                        value: t.registrationEnabled,
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
                </TaskDialog>
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
                  label={t.published ? "Unpublish" : "Publish tournament"}
                />
              </div>
            </>
          }
          players={
            <>
              {" "}
              <TaskDialog
                id="tournament-players"
                label="Choose players and create league matches"
                title={`Assign players · ${t.name}`}
              >
                {remainingPlayerPlaces > 0 ? (
                  <ActionForm
                    key={t.id}
                    action="assignParticipants"
                    resetOnSuccess
                    fixed={{ id: t.id }}
                    fields={[
                      {
                        name: "memberIds",
                        label: "Choose players to add",
                        type: "members",
                        options: approvedMembers.filter(
                          (m) =>
                            !t.participants.some((p) => p.memberId === m.value),
                        ),
                        max: remainingPlayerPlaces,
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
                ) : (
                  <p className="feedback" role="status">
                    All {config.soloCapacity} player places are filled. Review
                    the assigned player list below, or use “Withdraw or replace
                    a player” to change an entrant.
                  </p>
                )}
                <hr className="divider" />
                <ActionForm
                  action="generateLeague"
                  fixed={{ id: t.id }}
                  fields={[reason]}
                  label="Create league matches"
                />
              </TaskDialog>
              {teamCategory && (
                <TaskDialog
                  id="tournament-teams"
                  label="Complete team rosters"
                  title={
                    teamToReview
                      ? `Edit roster · ${teamToReview.name}`
                      : `Create a team · ${t.name}`
                  }
                >
                  <TeamRosterForm
                    categoryId={teamCategory.id}
                    team={
                      teamToReview
                        ? {
                            id: teamToReview.id,
                            name: teamToReview.name,
                            avatarImage: teamToReview.avatarImage,
                            archived: teamToReview.archived,
                            memberIds: teamToReview.memberships.map(
                              (membership) => membership.memberId,
                            ),
                          }
                        : undefined
                    }
                    players={t.participants.map((player) => ({
                      value: player.memberId,
                      label: `${player.code} · ${player.member.displayIgn}`,
                      disabled: teamCategory.teams.some(
                        (team) =>
                          team.id !== teamToReview?.id &&
                          team.memberships.some(
                            (membership) =>
                              membership.memberId === player.memberId,
                          ),
                      ),
                    }))}
                  />
                  <Link className="text-link" href={`${base}/teams`}>
                    View all teams ↗
                  </Link>
                </TaskDialog>
              )}
              <TaskDialog
                id="tournament-eligibility"
                label="Review assigned players & eligibility"
                title={`Player eligibility · ${t.name}`}
              >
                <TournamentPlayerList
                  key={t.id}
                  tournamentId={t.id}
                  participants={t.participants.map((p) => ({
                    id: p.id,
                    code: p.code,
                    eligible: p.eligible,
                    member: {
                      displayIgn: p.member.displayIgn,
                      verified: p.member.verified,
                      archived: p.member.archived,
                    },
                  }))}
                  capacity={config.soloCapacity}
                  mappingConfirmed={t.mappingConfirmed}
                  published={t.published}
                />
              </TaskDialog>
              <div className="panel">
                <h3>Player list confirmation</h3>
                <p className="muted text-sm">
                  Check that the player names and codes match your approved
                  list. Approve registrations and confirm each player can
                  compete before publishing.
                </p>
                <TaskDialog
                  id="player-list-confirmation"
                  label="Confirm player list"
                  title={`Player list confirmation · ${t.name}`}
                >
                  <p className="muted text-sm">
                    Check the assigned players and their eligibility before
                    confirming the list.
                  </p>
                  <TournamentPlayerList
                    tournamentId={t.id}
                    participants={t.participants.map((p) => ({
                      id: p.id,
                      code: p.code,
                      eligible: p.eligible,
                      member: {
                        displayIgn: p.member.displayIgn,
                        verified: p.member.verified,
                        archived: p.member.archived,
                      },
                    }))}
                    capacity={config.soloCapacity}
                    mappingConfirmed={t.mappingConfirmed}
                    published={t.published}
                  />
                  <ActionForm
                    action="mapping"
                    fixed={{ id: t.id }}
                    fields={[reason]}
                    label="Confirm player list"
                  />
                </TaskDialog>
              </div>
              <TaskDialog
                label="Withdraw or replace a player"
                title="Withdraw or replace a player"
                description={t.name}
              >
                <p className="muted">
                  Choose an entrant and optionally a replacement. The previous
                  entry stays in history. Unplayed draft fixtures are rebuilt,
                  so check their schedule and confirm the player list again. A
                  replacement inherits the team place and ownership, if any.
                  Started competition requires an admin-controlled restart.
                </p>
                <ActionForm
                  action="changeEntrant"
                  label="Save player change"
                  fields={[
                    {
                      name: "id",
                      label: "Current entrant",
                      type: "select",
                      required: true,
                      options: t.participants.map((p) => ({
                        value: p.id,
                        label: `${p.code} · ${p.member.displayIgn}`,
                      })),
                    },
                    {
                      name: "replacementMemberId",
                      label: "Replacement (leave blank to withdraw)",
                      type: "select",
                      options: approvedMembers.filter(
                        (m) =>
                          !t.participants.some((p) => p.memberId === m.value),
                      ),
                    },
                    requiredReason,
                  ]}
                />
              </TaskDialog>
              <Link className="button secondary" href={`${base}/teams`}>
                Manage team rosters ↗
              </Link>
            </>
          }
          stages={
            <>
              {" "}
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
                  <div className="tournament-stage-actions">
                    <TaskDialog
                      id={`tournament-rules-${s.id}`}
                      label="Edit tournament rules"
                      title={`Tournament rules · ${s.name}`}
                      description={t.name}
                    >
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
                            kind: t.categories.find(
                              (c) => c.id === s.categoryId,
                            )?.kind,
                          },
                          reason,
                        ]}
                      />
                    </TaskDialog>
                    <TaskDialog
                      label="Manage stage progression"
                      title={`Stage progression · ${s.name}`}
                      description={t.name}
                    >
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
                              (rankingChoices.get(s.id) ?? []).some((p) =>
                                p.label.includes(" · Tied"),
                              )
                                ? requiredReason
                                : reason,
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
                            t.categories.find((c) => c.id === s.categoryId)
                              ?.kind === "SOLO"
                              ? "soloBracket"
                              : "teamBracket"
                          }
                          fixed={{ categoryId: s.categoryId }}
                          label="Create confirmed bracket"
                          fields={
                            t.categories.find((c) => c.id === s.categoryId)
                              ?.kind === "SOLO"
                              ? (s.rules as Rules).knockoutPairing === "manual"
                                ? [
                                    {
                                      name: "rankedIds",
                                      label: "SOLO knockout starting order",
                                      type: "ordered",
                                      options: qualifiedChoices,
                                      value: qualifiedChoices.map(
                                        (p) => p.value,
                                      ),
                                      complete: true,
                                      min:
                                        config.directSlots +
                                        config.playoffSlots,
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
                                    options:
                                      teamChoices.get(s.categoryId) ?? [],
                                    value: (
                                      teamChoices.get(s.categoryId) ?? []
                                    ).map((p) => p.value),
                                    complete: true,
                                    min: config.teamCapacity,
                                    required: true,
                                  },
                                  reason,
                                ]
                          }
                        />
                      )}
                    </TaskDialog>
                  </div>
                </div>
              ))}
              <Link
                className="text-link"
                href={`${base}/matches?tournamentId=${t.id}&history=${q.history === "true" ? "false" : "true"}`}
              >
                {q.history === "true"
                  ? "Show active stages"
                  : "Show retained stage / result history"}
              </Link>
            </>
          }
          updates={
            <>
              {" "}
              <TaskDialog
                label={`Change tournament sizes · update ${t.configurationVersion}`}
                title={`Tournament sizes · ${t.name}`}
              >
                <TournamentConfigForm id={t.id} configuration={config} />
              </TaskDialog>
              <details
                className="panel"
                open={revisions.some((r) => r.status === "PENDING")}
              >
                <summary className="text-link cursor-pointer">
                  Update history · {revisions.length}{" "}
                  {revisions.some((r) => r.status === "PENDING")
                    ? "· Review needed"
                    : "· No pending updates"}
                </summary>
                <p className="muted text-sm mt-3">
                  Applied updates are saved history. Only pending updates need a
                  decision.
                </p>
                <div className="tournament-update-list">
                  {revisions.map((r) => (
                    <TaskDialog
                      key={r.id}
                      label={`Tournament update ${r.version} · ${friendlyLabel(r.status)}`}
                      title={`Review tournament update ${r.version}`}
                      description={t.name}
                    >
                      <p>{decrypt(r.reasonEncrypted, `tournament:${t.id}`)}</p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Setting</th>
                              <th>Before update</th>
                              <th>New sizes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {configurationRows(r.configuration).map(
                              (row, i) => (
                                <tr key={row.key}>
                                  <td>{row.label}</td>
                                  <td>
                                    {
                                      configurationRows(r.beforeConfiguration)[
                                        i
                                      ]?.value
                                    }
                                  </td>
                                  <td>{row.value}</td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                      {r.status === "PENDING" && actor.role === "ADMIN" && (
                        <>
                          <div className="notice">
                            Applying a controlled restart retains previous
                            matches, scores, evidence and standings in archived
                            stages. Previous results will not count toward the
                            new revision. Resolve affected brackets by
                            restarting stages and reconfirming rules; no
                            entrants are removed.
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
                              requiredReason,
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
                        <p>
                          {decrypt(r.resolutionEncrypted, `revision:${r.id}`)}
                        </p>
                      )}
                    </TaskDialog>
                  ))}
                </div>
              </details>
            </>
          }
        />
      </div>
    );
  }
  if (section === "teams") {
    const categories = await tx.category.findMany({
      where: { kind: "TEAM" },
      include: {
        tournament: {
          select: {
            name: true,
            participants: {
              where: {
                eligible: true,
                withdrawn: false,
                member: { verified: true, archived: false },
              },
              select: {
                code: true,
                memberId: true,
                member: { select: { displayIgn: true } },
              },
              orderBy: { code: "asc" },
            },
          },
        },
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
              Exactly four registered, eligible tournament players per team.
              Players may belong to only one active team in this category.
            </p>
            <p className="muted text-sm">
              {c.teams.filter((t) => !t.archived).length}/{c.capacity} team
              slots assigned
            </p>
            <TaskDialog
              label="Create a team"
              title={`Create a team · ${c.tournament.name}`}
            >
              <TeamRosterForm
                categoryId={c.id}
                players={c.tournament.participants.map((p) => ({
                  value: p.memberId,
                  label: `${p.code} · ${p.member.displayIgn}`,
                  disabled: c.teams.some(
                    (t) =>
                      !t.archived &&
                      t.memberships.some((m) => m.memberId === p.memberId),
                  ),
                }))}
              />
            </TaskDialog>
            <div className="stack">
              {c.teams.map((team) => (
                <article className="panel" key={team.id}>
                  <div className="row">
                    <TeamAvatar image={team.avatarImage} name={team.name} />
                    <h3 className="mb-0">
                      {team.code} · {team.name}
                    </h3>
                    <span
                      className={`badge ${team.archived ? "neutral" : team.memberships.length === 4 ? "" : "warning"}`}
                    >
                      {team.archived
                        ? "Archived"
                        : `${team.memberships.length}/4 players`}
                    </span>
                  </div>
                  <p className="muted text-sm mt-3">
                    {team.memberships
                      .map((m) => m.member.displayIgn)
                      .join(" · ") || "No players assigned"}
                  </p>
                  <TaskDialog
                    label="Edit team roster"
                    title={`Edit roster · ${team.name}`}
                  >
                    <TeamRosterForm
                      categoryId={c.id}
                      team={{
                        id: team.id,
                        name: team.name,
                        avatarImage: team.avatarImage,
                        archived: team.archived,
                        memberIds: team.memberships.map((m) => m.memberId),
                      }}
                      players={c.tournament.participants.map((p) => ({
                        value: p.memberId,
                        label: `${p.code} · ${p.member.displayIgn}`,
                        disabled: c.teams.some(
                          (t) =>
                            t.id !== team.id &&
                            !t.archived &&
                            t.memberships.some(
                              (m) => m.memberId === p.memberId,
                            ),
                        ),
                      }))}
                    />
                  </TaskDialog>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (section === "matches") {
    const stageChoices = await tx.stage.findMany({
      where: {
        ...(q.tournamentId
          ? { category: { tournamentId: q.tournamentId } }
          : {}),
        ...(q.history === "true" ? {} : { archived: false }),
      },
      select: {
        id: true,
        name: true,
        category: {
          select: {
            tournamentId: true,
            tournament: { select: { name: true } },
          },
        },
        rounds: {
          orderBy: { number: "asc" },
          select: {
            id: true,
            number: true,
            name: true,
            _count: { select: { matches: true } },
          },
        },
      },
      orderBy: [
        { category: { tournament: { createdAt: "desc" } } },
        { key: "asc" },
      ],
    });
    const selectedStage =
      stageChoices.find((s) => s.id === q.stageId) ??
      stageChoices.find((s) => s.rounds.length) ??
      stageChoices[0];
    if (!selectedStage)
      return (
        <div className="empty">
          <strong>No fixtures yet</strong>Prepare a tournament and create its
          matches first.
        </div>
      );
    const selectedRound =
      selectedStage.rounds.find((r) => String(r.number) === q.round) ??
      selectedStage.rounds[0];
    const participants = await tx.participant.findMany({
        where: { tournamentId: selectedStage.category.tournamentId },
        select: {
          id: true,
          code: true,
          tournamentId: true,
          member: { select: { displayIgn: true } },
        },
      }),
      teams = await tx.team.findMany({
        where: {
          category: { tournamentId: selectedStage.category.tournamentId },
        },
        select: { id: true, name: true, categoryId: true },
      });
    const names = new Map([
      ...participants.map(
        (p) => [p.id, `${p.code} · ${p.member.displayIgn}`] as const,
      ),
      ...teams.map((t) => [t.id, t.name] as const),
    ]);
    const statusOptions = [
      "SCHEDULED",
      "IN_PROGRESS",
      "RESULT_SUBMITTED",
      "FINALIZED",
      "DISPUTED",
      "VOIDED",
      "BYE",
    ] as const;
    const matchStatus = statusOptions.find((status) => status === q.status);
    const matchingIds = query
      ? [...names]
          .filter(([, name]) =>
            name.toLowerCase().includes(query.toLowerCase().trim()),
          )
          .map(([id]) => id)
      : [];
    const editorWhere = {
      ...(matchStatus ? { status: matchStatus } : {}),
      ...(query
        ? {
            OR: [
              { sideAId: { in: matchingIds } },
              { sideBId: { in: matchingIds } },
            ],
          }
        : {}),
    };
    const totalMatches = selectedRound
      ? query || matchStatus
        ? await tx.match.count({
            where: { roundId: selectedRound.id, ...editorWhere },
          })
        : selectedRound._count.matches
      : 0;
    const matchPage = Math.max(
      1,
      Math.min(Math.ceil(totalMatches / 8) || 1, page),
    );
    const stages = await tx.stage.findMany({
      where: { id: selectedStage.id },
      include: {
        category: { include: { tournament: { select: { name: true } } } },
        rounds: {
          where: { id: selectedRound?.id ?? "none" },
          orderBy: { number: "asc" },
          include: {
            matches: {
              where: editorWhere,
              skip: (matchPage - 1) * 8,
              take: 8,
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
      if (stage.format === "LEAGUE" && q.standings === "true")
        stageStandings.set(
          stage.id,
          stage.archived
            ? ((stage.archivedStandings ?? []) as Awaited<
                ReturnType<typeof standingsFor>
              >["rows"])
            : (await standingsFor(tx, stage.id)).rows,
        );
    const previewMatches = selectedRound
      ? await tx.match.findMany({
          where: { roundId: selectedRound.id },
          orderBy: { order: "asc" },
          select: {
            id: true,
            order: true,
            sideAId: true,
            sideBId: true,
            status: true,
            bestOf: true,
            scheduledAt: true,
            currentResult: {
              select: {
                status: true,
                outcome: true,
                games: { select: { number: true, scoreA: true, scoreB: true } },
              },
            },
          },
        })
      : [];
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
        <Form action={`${base}/matches`} className="form panel fixture-filters">
          {q.tournamentId && (
            <input type="hidden" name="tournamentId" value={q.tournamentId} />
          )}
          {q.history === "true" && (
            <input type="hidden" name="history" value="true" />
          )}
          <FixtureStageFields
            key={`${selectedStage.id}:${selectedRound?.number ?? ""}`}
            selectedStageId={selectedStage.id}
            selectedRound={selectedRound?.number}
            stages={stageChoices.map((s) => ({
              id: s.id,
              label: `${s.category.tournament.name} · ${s.name}`,
              rounds: s.rounds.map((r) => ({
                number: r.number,
                label: `${r.name} · ${r._count.matches} series`,
              })),
            }))}
          />
          <div className="grid2">
            <label htmlFor="fixture-search">
              Player name, code or team
              <input
                id="fixture-search"
                name="q"
                defaultValue={query}
                placeholder="Find a player's match"
              />
            </label>
            <label htmlFor="fixture-status">
              Match status
              <select
                id="fixture-status"
                name="status"
                defaultValue={matchStatus ?? ""}
              >
                <option value="">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {friendlyLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="button secondary small">Show fixtures</button>
        </Form>
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
              {s.format === "LEAGUE" &&
                (q.standings === "true" ? (
                  <details className="details" open>
                    <summary>
                      Current standings · tied players need a decision
                    </summary>
                    <Standings rows={stageStandings.get(s.id) ?? []} />
                  </details>
                ) : (
                  <Link
                    className="text-link"
                    href={`${base}/matches?stageId=${s.id}&round=${selectedRound?.number ?? 1}&standings=true${q.history === "true" ? "&history=true" : ""}`}
                  >
                    Show current standings ↗
                  </Link>
                ))}
              {!s.rounds.length && (
                <div className="empty">
                  Fixtures await confirmed rules and participants.
                </div>
              )}
              {s.format === "LEAGUE" && s.rounds.length > 0 && (
                <TaskDialog
                  label="Visual fixture preview"
                  title={`Fixture preview · ${s.name}`}
                >
                  <div className="mt-5">
                    <FixtureBrowser
                      title={s.name}
                      draft
                      rounds={s.rounds.map((r) => ({
                        number: r.number,
                        name: r.name,
                        matches: previewMatches.map((m) => {
                          const result =
                            m.currentResult?.status === "ACCEPTED"
                              ? m.currentResult
                              : null;
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
                </TaskDialog>
              )}
              {s.rounds.map((r) => (
                <details className="panel mb-4" key={r.id} open>
                  <summary className="cursor-pointer text-lime">
                    {r.name} ·{" "}
                    {selectedRound?._count.matches ?? r.matches.length} series
                  </summary>
                  <div className="stack mt-5">
                    {!r.matches.length && (
                      <div className="empty">
                        <strong>No matching fixtures</strong>Try a different
                        name or status.
                      </div>
                    )}
                    {r.matches.map((m) => (
                      <article key={m.id} className="panel">
                        <div className="min-w-0">
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
                            {m.scheduledAt &&
                              ` · ${operationalTime(m.scheduledAt)}`}
                          </p>
                          {m.results[0] && (
                            <p className="text-sm">
                              <strong>
                                {m.results[0].games
                                  .map(
                                    (g, index) =>
                                      `Game ${index + 1}: ${names.get((g.scoreA > g.scoreB ? m.sideAId : m.sideBId) ?? "") ?? "Player"} wins`,
                                  )
                                  .join(" / ") ||
                                  friendlyLabel(m.results[0].outcome)}
                              </strong>
                              <span className="muted">
                                {" "}
                                · {friendlyLabel(m.results[0].status)}
                              </span>
                            </p>
                          )}
                          {m.dependencies.map((d) => (
                            <TaskDialog
                              key={d.id}
                              label="Review changed opponents"
                              title={`Review opponents · Match ${m.order}`}
                              readOnly={s.archived}
                            >
                              An earlier result changed. Review the opponents
                              before continuing.
                              {actor.role === "ADMIN" && (
                                <ActionForm
                                  action="dependency"
                                  fixed={{ id: d.id }}
                                  fields={[
                                    requiredReason,
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
                            </TaskDialog>
                          ))}
                          <TaskDialog
                            label="Enter / correct result"
                            title="Enter / correct result"
                            description={`Match ${m.order} · ${names.get(m.sideAId ?? "") ?? "Player A"} vs ${names.get(m.sideBId ?? "") ?? "Player B"}`}
                            readOnly={s.archived}
                          >
                            <MatchResultForm
                              matchId={m.id}
                              bestOf={m.bestOf}
                              knockout={s.format === "KNOCKOUT"}
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
                                    ? "This is a bye; there are no game winners to pick."
                                    : m.status === "VOIDED"
                                      ? "This match has been voided and cannot receive a result."
                                      : !m.sideAId || !m.sideBId
                                        ? "Both opponents must be assigned before entering a result."
                                        : m.dependencies.length
                                          ? "An admin needs to resolve the bracket changes before this result can be submitted."
                                          : undefined
                              }
                            />
                          </TaskDialog>
                          {!!m.results.length && (
                            <TaskDialog
                              label={`Result history & review (${m.results.length})`}
                              title={`Result history · Match ${m.order}`}
                              description={`${names.get(m.sideAId ?? "") ?? "Player A"} vs ${names.get(m.sideBId ?? "") ?? "Player B"}`}
                              readOnly={s.archived}
                            >
                              <div className="stack">
                                {m.results.map((v) => (
                                  <section key={v.id} className="panel">
                                    <h3>
                                      Result {v.version} ·{" "}
                                      {friendlyLabel(v.outcome)} ·{" "}
                                      {friendlyLabel(v.status)}
                                    </h3>
                                    <p className="muted text-xs">
                                      {operationalTime(v.createdAt)} ·{" "}
                                      {v.games
                                        .map(
                                          (g, index) =>
                                            `Game ${index + 1}: ${names.get((g.scoreA > g.scoreB ? m.sideAId : m.sideBId) ?? "") ?? "Player"} wins`,
                                        )
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
                                          fixed={{
                                            id: v.id,
                                            action: "DISPUTE",
                                          }}
                                          fields={[requiredReason]}
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
                                  </section>
                                ))}
                              </div>
                            </TaskDialog>
                          )}
                          {m.disputes.map((d) => (
                            <TaskDialog
                              key={d.id}
                              label={
                                d.resolved
                                  ? "View resolved dispute"
                                  : "Resolve dispute"
                              }
                              title={`Dispute · Match ${m.order}`}
                              readOnly={s.archived}
                            >
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
                                    requiredReason,
                                  ]}
                                  label="Resolve dispute"
                                />
                              )}
                            </TaskDialog>
                          ))}
                          <TaskDialog
                            label="Match schedule and actions"
                            title={`Manage match ${m.order}`}
                            description={`${names.get(m.sideAId ?? "") ?? "Player A"} vs ${names.get(m.sideBId ?? "") ?? "Player B"}`}
                            readOnly={s.archived}
                          >
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
                              fields={[
                                m.status === "SCHEDULED"
                                  ? reason
                                  : requiredReason,
                              ]}
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
                          </TaskDialog>
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              ))}
              <Pagination
                page={matchPage}
                total={totalMatches}
                size={8}
                base={`${base}/matches`}
                query={{
                  ...q,
                  stageId: s.id,
                  round: String(selectedRound?.number ?? 1),
                }}
              />
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
        <TaskDialog label="Create announcement" title="Create announcement">
          <ActionForm
            action="announcement"
            fixed={{ published: false }}
            fields={[
              { name: "title", label: "Title", required: true },
              {
                name: "body",
                label: "Bahasa Melayu copy",
                type: "textarea",
                required: true,
              },
              { name: "published", label: "Publish", type: "checkbox" },
              { name: "titleEn", label: "English title" },
              {
                name: "bodyEn",
                label: "English announcement",
                type: "textarea",
              },
              reason,
            ]}
          />
        </TaskDialog>
        {!rows.length && (
          <p className="empty">
            No announcements yet. Create one to prepare your first update.
          </p>
        )}
        {rows.map((r) => (
          <TaskDialog
            key={r.id}
            label={`${r.title} · ${r.published ? "Published" : "Draft"}`}
            title={`Announcement · ${r.title}`}
          >
            <ActionForm
              action="announcement"
              fixed={{ id: r.id, published: r.published }}
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
          </TaskDialog>
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
  if (section === "audit") return renderActivityHistory(tx, actor, q, base);
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
    const suspended = q.status === "all" ? undefined : q.status === "suspended";
    const where = {
      ...(suspended === undefined ? {} : { suspended }),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              { email: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      tx.staffUser.findMany({
        where,
        skip,
        take: 20,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          suspended: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      tx.staffUser.count({ where }),
    ]);
    return (
      <div className="stack">
        <AddStaffAccount />
        <Form action={`${base}/staff`} className="filter staff-account-filter">
          <label className="sr-only" htmlFor="staff-search">
            Search staff
          </label>
          <input
            id="staff-search"
            name="q"
            placeholder="Search name or email"
            defaultValue={query}
          />
          <label className="sr-only" htmlFor="staff-status">
            Account status
          </label>
          <select
            id="staff-status"
            name="status"
            defaultValue={q.status ?? "active"}
          >
            <option value="active">Active accounts</option>
            <option value="suspended">Suspended accounts</option>
            <option value="all">All accounts</option>
          </select>
          <button className="button small secondary">Search</button>
        </Form>
        {!users.length && (
          <div className="empty">
            <strong>No matching staff accounts</strong>Change the search or
            status filter.
          </div>
        )}
        {users.map((u) => (
          <StaffAccountRow key={u.id} account={u} current={u.id === actor.id} />
        ))}
        <Pagination
          page={page}
          total={total}
          base={`${base}/staff`}
          query={q}
        />
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
