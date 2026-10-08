import { cookies } from "next/headers";
import { boundedFormData, boundedJson } from "@/lib/request-body";
import { memberCookie, mutateTeam } from "@/lib/team-portal";
import { checkTeamRequest, teamError, teamHeaders } from "@/lib/team-request";
import { MAX_TEAM_IMAGE_REQUEST_BYTES } from "@/lib/team-avatar-policy";
import { DomainError } from "@/lib/domain";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const token = (await cookies()).get(memberCookie)?.value;
    await checkTeamRequest(request, "action", token);
    const { slug } = await params;
    if (!token) throw new DomainError("SIGN_IN", 401);
    let input: unknown;
    let image: File | undefined;
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const form = await boundedFormData(request, MAX_TEAM_IMAGE_REQUEST_BYTES);
      input = { action: form.get("action"), name: form.get("name") };
      if (form.get("action") !== "CREATE")
        throw new DomainError("VALIDATION", 400);
      const upload = form.get("image");
      if (upload instanceof File) {
        if (upload.name || upload.size) image = upload;
      } else if (upload !== null) throw new DomainError("INVALID_IMAGE", 400);
    } else input = await boundedJson(request, 2000);
    const result = await mutateTeam(token, slug, input, image);
    return Response.json(result, { headers: teamHeaders });
  } catch (error) {
    return teamError(error);
  }
}
