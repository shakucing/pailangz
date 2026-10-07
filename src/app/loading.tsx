import { getLocale, translate } from "@/lib/i18n";
export default async function Loading() {
  const locale = await getLocale();
  return (
    <div className="wrap loading" role="status">
      {translate(locale, "Memuatkan arena…", "Loading the arena…")}
    </div>
  );
}
