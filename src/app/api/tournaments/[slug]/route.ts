import { publicTournament } from "@/lib/public-data";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const t = await publicTournament(slug);
    return Response.json(t ?? { error: "Published tournament not found." }, {
      status: t ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Tournament unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
