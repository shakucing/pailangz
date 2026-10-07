import { NavigationLink as Link } from "@/components/navigation-link";
import { publishedTournaments, dateText } from "@/lib/public-data";
import { getLocale, translate } from "@/lib/i18n";
export const dynamic = "force-dynamic";
export default async function Tournaments() {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  const rows = await publishedTournaments();
  return (
    <div className="wrap">
      <div className="page-heading">
        <div className="eyebrow">Community arena</div>
        <h1>{t("Kejohanan", "Tournaments")}</h1>
        <p className="muted">
          {t(
            "Jadual, peserta dan keputusan rasmi. Semua dalam satu tempat.",
            "Fixtures, participants and official results. All in one place.",
          )}
        </p>
      </div>
      <section className="section" style={{ paddingTop: 0 }}>
        {rows.length ? (
          <div className="grid2">
            {rows.map((tournament) => (
              <Link
                className="panel"
                href={`/tournaments/${tournament.slug}`}
                key={tournament.slug}
              >
                <span className="badge">
                  {tournament.status.replaceAll("_", " ")}
                </span>
                <h3 className="mt-5">{tournament.name}</h3>
                <p className="muted">{dateText(tournament.startsAt, locale)}</p>
                <div className="row">
                  {tournament.categories.map((c) => (
                    <span className="badge neutral" key={c.kind}>
                      {c.kind}
                    </span>
                  ))}
                  <span className="text-link ml-auto">
                    {t("Lihat arena ↗", "View arena ↗")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <strong>
              {t("Arena sedang disediakan.", "The arena is being prepared.")}
            </strong>
            {t(
              "Tiada kejohanan diterbitkan buat masa ini. Tarikh akan diumumkan.",
              "No tournaments have been published yet. Dates will be announced.",
            )}
          </div>
        )}
      </section>
    </div>
  );
}
