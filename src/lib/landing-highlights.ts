import { z } from "zod";
import { audit, privateTx, type Actor } from "./db";
import { DomainError, noteSchema } from "./domain";
import { configuration } from "./tournament-config";

export const landingHighlightsSchema = z.object({
  soloId: z
    .string()
    .uuid()
    .nullish()
    .transform((id) => id ?? null),
  teamId: z
    .string()
    .uuid()
    .nullish()
    .transform((id) => id ?? null),
  reason: noteSchema,
});

export async function saveLandingHighlights(
  actor: Actor,
  raw: z.input<typeof landingHighlightsSchema>,
) {
  const input = landingHighlightsSchema.parse(raw);
  return privateTx(actor, async (tx) => {
    // Lock existing slots. Serializable transactions and primary keys also
    // protect the first save, when neither format has a row yet.
    await tx.$queryRaw`SELECT format FROM "LandingHighlight" ORDER BY format FOR UPDATE`;
    const before = await tx.landingHighlight.findMany({
      orderBy: { format: "asc" },
    });
    const selections = [
      { format: "SOLO", tournamentId: input.soloId },
      { format: "TEAM", tournamentId: input.teamId },
    ];
    for (const { format, tournamentId } of selections) {
      if (!tournamentId) continue;
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
      });
      if (configuration(tournament.configuration).format !== format)
        throw new DomainError(
          `Choose a ${format} tournament for the ${format} highlight.`,
        );
      if (tournament.status === "ARCHIVED")
        throw new DomainError("Archived tournaments cannot be highlighted.");
    }
    for (const { format, tournamentId } of selections)
      await tx.landingHighlight.upsert({
        where: { format },
        create: { format, tournamentId },
        update: { tournamentId },
      });
    await audit(
      tx,
      actor,
      "LANDING_HIGHLIGHTS_UPDATE",
      "LANDING_PAGE",
      "highlights",
      {
        before: before.map(({ format, tournamentId }) => ({
          format,
          tournamentId,
        })),
        after: selections,
      },
      input.reason,
    );
    return { saved: true };
  });
}
