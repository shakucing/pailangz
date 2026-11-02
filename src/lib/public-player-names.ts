import "server-only";
import { db } from "./db";

export async function publicPlayerNames(slug: string) {
  return db.$queryRaw<{ code: string; ign: string; familyLabel: string }[]>`
    SELECT code, ign, "familyLabel" FROM "PublicEventPlayerName" WHERE slug = ${slug}
  `;
}
