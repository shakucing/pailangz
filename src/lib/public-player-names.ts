import "server-only";
import { db } from "./db";

export async function publicPlayerNames(slug: string) {
  return db.$queryRaw<{ code: string; ign: string }[]>`
    SELECT code, ign FROM "PublicEventPlayerName" WHERE slug = ${slug}
  `;
}
