import type { Metadata } from "next";
import { getLocale, translate } from "@/lib/i18n";
import { dateText } from "@/lib/public-data";
import {
  ParticipationClosed,
  ParticipationForm,
} from "@/components/participation-form";
import {
  participationStatus,
  registrationEvent,
} from "@/lib/participation-status";
import styles from "@/components/participation-form.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(
      locale,
      "Penyertaan kejohanan",
      "Tournament participation",
    ),
    robots: { index: false, follow: false },
  };
}

export default async function Participate({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  const [event, status] = await Promise.all([
    registrationEvent(slug),
    participationStatus(slug),
  ]);
  return (
    <div className={`wrap ${styles.page}`}>
      <div className="page-heading">
        <div className="eyebrow">{event?.name ?? "PAILANGZ & PAILANGZZ"}</div>
        <h1>{t("Penyertaan kejohanan", "Tournament participation")}</h1>
        {event && (
          <>
            <p className="muted whitespace-pre-wrap">
              {locale === "en" && event.overviewEn
                ? event.overviewEn
                : event.overview}
            </p>
            <p className="muted">
              {t(
                `Terhad kepada ${event.capacity} pemain. Satu penyertaan untuk SOLO & TEAM. Sahkan maklumat anda dengan rekod ahli yang sedia ada.`,
                `Limited to ${event.capacity} players. One submission for SOLO & TEAM. Verify your details against your existing member record.`,
              )}
            </p>
            {event.gameTitle && <p>{event.gameTitle}</p>}
            {event.startsAt && (
              <p>
                {t("Mula", "Starts")}: {dateText(event.startsAt, locale)}
              </p>
            )}
            {event.registrationDeadline && (
              <p>
                {t("Pendaftaran ditutup", "Registration closes")}:{" "}
                {dateText(event.registrationDeadline, locale)}
              </p>
            )}
          </>
        )}
      </div>
      {event && status === "OPEN" ? (
        <ParticipationForm slug={slug} />
      ) : (
        <ParticipationClosed
          slug={slug}
          status={status === "FULL" ? "FULL" : "CLOSED"}
        />
      )}
    </div>
  );
}
