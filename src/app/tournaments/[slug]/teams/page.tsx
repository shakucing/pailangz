import { notFound } from "next/navigation";
import { publicTeamEvent, publicTeams } from "@/lib/team-portal";
import { TeamDirectory } from "@/components/team-directory";
import { getLocale, translate } from "@/lib/i18n";
export const dynamic = "force-dynamic";
export const metadata = { title: "Teams · PAILANGZ & PAILANGZZ" };
export default async function Teams({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await publicTeamEvent(slug);
  if (!event) notFound();
  const teams = await publicTeams(slug);
  const locale = await getLocale();
  return (
    <div className="wrap">
      <div className="page-heading">
        <div className="eyebrow">{event.name}</div>
        <h1>{translate(locale, "Pasukan kejohanan", "Tournament teams")}</h1>
        <p className="muted">
          {teams.length}/{event.capacity}{" "}
          {translate(
            locale,
            "pasukan · Empat pemain setiap pasukan",
            "teams · Four players per team",
          )}
        </p>
        {event.teamRosterManagement === "STAFF" && (
          <p className="muted">
            {translate(
              locale,
              "Pemain mendaftar secara individu. Pihak staf membentuk pasukan dan menetapkan roster.",
              "Players register individually. Staff form teams and assign the rosters.",
            )}
          </p>
        )}
      </div>
      <TeamDirectory
        teams={teams}
        slug={slug}
        showRegistration={event.teamRosterManagement !== "STAFF"}
      />
    </div>
  );
}
