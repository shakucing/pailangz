import { NavigationLink as Link } from "./navigation-link";
import { announcementExcerpt } from "@/lib/announcement-content";
import { translate, type Locale } from "@/lib/i18n";

export function AnnouncementCard({
  announcement,
  locale,
}: {
  announcement: { id: string; title: string; body: string };
  locale: Locale;
}) {
  return (
    <Link className="panel" href={`/announcements/${announcement.id}`}>
      <h3>{announcement.title}</h3>
      <p className="muted">{announcementExcerpt(announcement.body)}</p>
      <span className="text-link">
        {translate(locale, "Baca pengumuman ↗", "Read announcement ↗")}
      </span>
    </Link>
  );
}
