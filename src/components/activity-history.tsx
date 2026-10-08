import { TaskDialog } from "./workspace-dialog";
import Link from "next/link";
import type { Actor, Tx } from "@/lib/db";
import {
  activityLabel,
  activityDetails,
  friendlyLabel,
} from "@/lib/staff-presentation";
import { operationalTime } from "@/lib/public-data";
import { AuditExport } from "./action-form";
import { SectionPages } from "./operations-sections";
import styles from "./ops-workspace.module.css";
const reads = [
  "STAFF_VIEW",
  "PRIVATE_DETAILS_READ",
  "PRIVATE_PHONE_REVEAL",
  "AUDIT_EXPORT",
  "PRIVATE_EXPORT",
];
export async function renderActivityHistory(
  tx: Tx,
  actor: Actor,
  q: Record<string, string | undefined>,
  base: string,
) {
  const scope = q.scope ?? "changes",
    query = q.q?.trim().slice(0, 100);
  const staff = await tx.staffUser.findMany({
    select: { id: true, name: true },
  });
  const names = new Map(staff.map((u) => [u.id, u.name]));
  const where = {
    ...(actor.role === "MODERATOR"
      ? { entityType: { notIn: ["STAFF", "SECURITY", "SETTING"] } }
      : {}),
    ...(scope === "changes"
      ? { action: { notIn: reads }, NOT: { entityType: "SECURITY" } }
      : scope === "access"
        ? { OR: [{ action: { in: reads } }, { entityType: "SECURITY" }] }
        : {}),
    ...(query
      ? {
          AND: [
            {
              OR: [
                { action: { contains: query, mode: "insensitive" as const } },
                {
                  actorId: {
                    in: staff
                      .filter((u) =>
                        u.name.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((u) => u.id),
                  },
                },
              ],
            },
          ],
        }
      : {}),
  };
  const page = Math.max(1, Math.min(10000, Number(q.page) || 1));
  const [rows, total] = await Promise.all([
    tx.auditEvent.findMany({
      where,
      skip: (page - 1) * 50,
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
    tx.auditEvent.count({ where }),
  ]);
  const entities = new Map<string, { name: string; href?: string }>();
  async function collect(
    type: string,
    fetch: (
      ids: string[],
    ) => Promise<{ id: string; name: string; href?: string }[]>,
  ) {
    const ids = [
      ...new Set(
        rows.filter((r) => r.entityType === type).map((r) => r.entityId),
      ),
    ];
    if (ids.length)
      for (const row of await fetch(ids))
        entities.set(`${type}:${row.id}`, row);
  }
  await Promise.all([
    collect("MEMBER", async (ids) =>
      (
        await tx.member.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayIgn: true },
        })
      ).map((r) => ({
        id: r.id,
        name: r.displayIgn,
        href: `${base}/members?q=${encodeURIComponent(r.displayIgn)}&state=all`,
      })),
    ),
    collect("SUBMISSION", async (ids) =>
      (
        await tx.registrationSubmission.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayIgn: true },
        })
      ).map((r) => ({
        id: r.id,
        name: r.displayIgn,
        href: `${base}/registrations?status=all&q=${encodeURIComponent(r.displayIgn)}`,
      })),
    ),
    collect("TOURNAMENT", async (ids) =>
      (
        await tx.tournament.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ ...r, href: `${base}/tournaments?id=${r.id}` })),
    ),
    collect("TEAM", async (ids) =>
      (
        await tx.team.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ ...r, href: `${base}/teams` })),
    ),
    collect("STAGE", async (ids) =>
      (
        await tx.stage.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((r) => ({ ...r, href: `${base}/matches?stageId=${r.id}` })),
    ),
    collect("MATCH", async (ids) =>
      (
        await tx.match.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            order: true,
            round: {
              select: {
                number: true,
                stageId: true,
                stage: { select: { name: true } },
              },
            },
          },
        })
      ).map((r) => ({
        id: r.id,
        name: `${r.round.stage.name} · Round ${r.round.number} · Match ${r.order}`,
        href: `${base}/matches?stageId=${r.round.stageId}&round=${r.round.number}`,
      })),
    ),
  ]);
  return (
    <div className="stack">
      <form className="filter" method="get">
        <label className="sr-only" htmlFor="activity-search">
          Search staff name or activity
        </label>
        <input
          id="activity-search"
          name="q"
          placeholder="Search staff name or activity"
          defaultValue={query}
        />
        <label className="sr-only" htmlFor="activity-scope">
          Activity type
        </label>
        <select id="activity-scope" name="scope" defaultValue={scope}>
          <option value="changes">Changes</option>
          <option value="access">Access and sign-ins</option>
          <option value="all">All activity</option>
        </select>
        <button className="button small secondary">Filter</button>
      </form>
      <div className={styles.list}>
        {rows.map((e) => {
          const entity = entities.get(`${e.entityType}:${e.entityId}`);
          return (
            <article className={styles.item} key={e.id}>
              <div className={styles.history}>
                <small>{operationalTime(e.createdAt)}</small>
                <strong>
                  {names.get(e.actorId ?? "") ?? friendlyLabel(e.actorRole)}
                </strong>
                <div>
                  <p>
                    {activityLabel(e.action)}
                    {e.outcome === "FAILURE" && (
                      <span className="badge warning ml-2">Failed</span>
                    )}
                  </p>
                  <p className={styles.meta}>
                    {entity?.href ? (
                      <Link href={entity.href}>{entity.name} ↗</Link>
                    ) : (
                      (entity?.name ?? friendlyLabel(e.entityType))
                    )}
                  </p>
                  {e.action === "MEMBER_UPDATE" &&
                    e.changes &&
                    typeof e.changes === "object" &&
                    !Array.isArray(e.changes) &&
                    "beforeIgn" in e.changes && (
                      <p className={styles.meta}>
                        {String(e.changes.beforeIgn)} →{" "}
                        {String(e.changes.afterIgn)}
                      </p>
                    )}
                  {!!activityDetails(e.changes).length && (
                    <TaskDialog
                      label="Change details"
                      title={activityLabel(e.action)}
                      description={operationalTime(e.createdAt)}
                    >
                      <dl className="readable-details">
                        {activityDetails(e.changes).map((d) => (
                          <div key={d.label}>
                            <dt>{d.label}</dt>
                            <dd>{d.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </TaskDialog>
                  )}
                  {e.reason && <p className={styles.meta}>{e.reason}</p>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <p className="empty">No activity matches these filters.</p>
      )}
      <SectionPages q={q} total={total} base={`${base}/audit`} />
      <TaskDialog
        label="Download activity history"
        title="Download activity history"
      >
        <AuditExport />
      </TaskDialog>
    </div>
  );
}
