import { notFound } from "next/navigation";
import { NavigationLink as Link } from "@/components/navigation-link";
import { HtmlContent } from "@/components/html-content";
import { publicAnnouncement, dateText } from "@/lib/public-data";
import { announcementExcerpt } from "@/lib/announcement-content";
import { getLocale, translate } from "@/lib/i18n";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const announcement = await publicAnnouncement(id);
  if (!announcement) notFound();
  return {
    title: announcement.title,
    description: announcementExcerpt(announcement.body, 160),
  };
}

export default async function AnnouncementPage({ params }: Props) {
  const { id } = await params;
  const [announcement, locale] = await Promise.all([
    publicAnnouncement(id),
    getLocale(),
  ]);
  if (!announcement) notFound();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  return (
    <div className={`wrap ${styles.page}`}>
      <div className="page-heading">
        <Link href="/#announcements" className="text-link">
          {t("← Pengumuman gang", "← Gang announcements")}
        </Link>
        <div className={`eyebrow ${styles.eyebrow}`}>
          {t("Pengumuman komuniti", "Community announcement")}
        </div>
        <h1 className={styles.title}>{announcement.title}</h1>
        <time
          className="muted text-sm"
          dateTime={announcement.createdAt.toISOString()}
        >
          {dateText(announcement.createdAt, locale)}
        </time>
      </div>
      <section className="section" style={{ paddingTop: 0 }}>
        <article className="panel">
          <HtmlContent>{announcement.body}</HtmlContent>
        </article>
      </section>
    </div>
  );
}
