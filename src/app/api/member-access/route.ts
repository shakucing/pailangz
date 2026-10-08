import { cookies } from "next/headers";
import { canonicalIgn } from "@/lib/domain";
import { boundedJson } from "@/lib/request-body";
import {
  memberAccessSchema,
  memberCookie,
  startMemberAccess,
  endMemberAccess,
} from "@/lib/team-portal";
import { checkTeamRequest, teamError, teamHeaders } from "@/lib/team-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = memberAccessSchema.parse(await boundedJson(request, 2000));
    await checkTeamRequest(request, "access", canonicalIgn(input.ign));
    const token = await startMemberAccess(input);
    const jar = await cookies();
    const old = jar.get(memberCookie)?.value;
    if (old) await endMemberAccess(old);
    jar.set(memberCookie, token, {
      httpOnly: true,
      secure:
        new URL(request.url).protocol === "https:" ||
        process.env.APP_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return Response.json({ accepted: true }, { headers: teamHeaders });
  } catch (error) {
    return teamError(error);
  }
}
export async function DELETE(request: Request) {
  try {
    await checkTeamRequest(request, "logout");
    const jar = await cookies();
    const token = jar.get(memberCookie)?.value;
    if (token) await endMemberAccess(token);
    jar.delete(memberCookie);
    return Response.json({ accepted: true }, { headers: teamHeaders });
  } catch (error) {
    return teamError(error);
  }
}
