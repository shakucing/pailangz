"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NavigationLink as Link } from "./navigation-link";
import { useLocale } from "./locale-context";
import type { PublicTeam, TeamState, TeamAction } from "@/lib/team-portal";
import styles from "./team-portal.module.css";
import { TeamAvatar } from "./team-avatar";
import { teamImageError } from "@/lib/team-avatar-policy";
import type { ParticipationStatus } from "@/lib/participation-status";

export function TeamPortal({
  slug,
  state,
  team,
  open,
  participationStatus,
}: {
  slug: string;
  state: TeamState | null;
  team?: PublicTeam;
  open: boolean;
  participationStatus: ParticipationStatus | null;
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [teamName, setTeamName] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setImagePreview(null);
    if (!imageFile) return;
    const reader = new FileReader();
    reader.onload = () => setImagePreview(String(reader.result));
    reader.onerror = () => {
      setImageFile(null);
      if (imageInput.current) imageInput.current.value = "";
      setError(
        locale === "en"
          ? "Unable to read this image. Choose another file."
          : "Imej tidak dapat dibaca. Pilih fail lain.",
      );
    };
    reader.readAsDataURL(imageFile);
    return () => {
      reader.onload = null;
      reader.onerror = null;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [imageFile, locale]);
  const base = `/tournaments/${slug}/teams`;
  const messages: Record<string, [string, string]> = {
    INVALID_IMAGE: [
      "Pilih imej PNG, JPEG atau WebP yang sah dan tidak beranimasi.",
      "Choose a valid, non-animated PNG, JPEG or WebP image.",
    ],
    IMAGE_TOO_LARGE: [
      "Imej terlalu besar. Pilih fail sehingga 4 MB.",
      "This image is too large. Choose a file up to 4 MB.",
    ],
    ORIGIN: [
      "Alamat halaman ini tidak dapat disahkan. Muat semula halaman dan cuba lagi.",
      "This page's address could not be verified. Reload the page and try again.",
    ],
    UNAVAILABLE: [
      "Perkhidmatan pasukan tidak tersedia buat sementara waktu. Sila cuba sebentar lagi.",
      "The team service is temporarily unavailable. Please try again shortly.",
    ],
    VERIFICATION_FAILED: [
      "Maklumat tidak sepadan dengan rekod ahli yang diluluskan. Semak IGN dan ID TikTok atau hubungi moderator.",
      "These details do not match an approved member record. Check your IGN and TikTok ID, or contact a moderator.",
    ],
    NOT_APPROVED: [
      "Anda perlukan slot kejohanan yang diluluskan sebelum boleh cipta atau sertai pasukan. Semak penyertaan kejohanan anda.",
      "You need an approved tournament slot to create or join a team. Check your tournament participation.",
    ],
    SIGN_IN: [
      "Sesi tamat. Sahkan semula maklumat anda.",
      "Your session expired. Verify your details again.",
    ],
    CLOSED: [
      "Pendaftaran pasukan dan permohonan telah ditutup.",
      "Team registration and applications are closed.",
    ],
    STAFF_MANAGED: [
      "Pihak staf membentuk pasukan dan menetapkan pemain untuk kejohanan ini.",
      "Staff form teams and assign players for this tournament.",
    ],
    ALREADY_IN_TEAM: [
      "Anda sudah menyertai pasukan untuk kejohanan ini.",
      "You already belong to a team in this tournament.",
    ],
    TOURNAMENT_FULL: [
      "Semua slot pasukan telah diisi.",
      "All tournament team slots are filled.",
    ],
    TEAM_FULL: [
      "Pasukan ini sudah mempunyai empat pemain.",
      "This team already has four players.",
    ],
    OWNER_ONLY: [
      "Hanya pemilik pasukan boleh menyemak permohonan ini.",
      "Only this team's owner can review these applications.",
    ],
    ALREADY_REVIEWED: [
      "Permohonan ini telah disemak. Muat semula halaman untuk status terkini.",
      "This application has already been reviewed. Refresh for the latest status.",
    ],
    APPLICANT_NOT_APPROVED: [
      "Kelulusan kejohanan pemohon tidak lagi aktif. Hubungi moderator atau tolak permohonan.",
      "The applicant no longer has active tournament approval. Contact a moderator or reject the application.",
    ],
    APPLICANT_IN_TEAM: [
      "Pemohon sudah menyertai pasukan lain.",
      "The applicant has already joined another team.",
    ],
    APPLICATIONS_CLOSED: [
      "Pasukan ini diurus oleh moderator dan tidak menerima permohonan.",
      "This team is managed by a moderator and does not accept applications.",
    ],
    RATE_LIMIT: [
      "Terlalu banyak cubaan. Cuba lagi dalam 10 minit.",
      "Too many attempts. Try again in 10 minutes.",
    ],
    VALIDATION: [
      "Semak dan lengkapkan semua medan.",
      "Check and complete all fields.",
    ],
    NOT_FOUND: [
      "Pasukan atau permohonan ini tidak lagi tersedia.",
      "This team or application is no longer available.",
    ],
  };
  async function send(
    url: string,
    method: string,
    body?: unknown,
    success?: string,
  ) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const multipart = body instanceof FormData;
      const response = await fetch(url, {
        method,
        ...(!multipart
          ? { headers: { "Content-Type": "application/json" } }
          : {}),
        ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        const copy = messages[data.error];
        setError(
          copy
            ? t(...copy)
            : t(
                "Tindakan tidak dapat diselesaikan. Cuba lagi.",
                "Unable to complete this action. Please try again.",
              ),
        );
        if (data.error === "SIGN_IN") router.refresh();
        return;
      }
      if (
        (multipart ? body.get("action") : (body as TeamAction)?.action) ===
        "CREATE"
      )
        router.push(`${base}/${data.slug}`);
      else if (success) setNotice(success);
      router.refresh();
    } catch {
      setError(
        t(
          "Sambungan terputus. Cuba lagi.",
          "Connection interrupted. Please try again.",
        ),
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const action = (body: TeamAction, success: string) =>
    send(`/api/teams/${slug}`, "POST", body, success);
  return (
    <section
      id={team ? "team-applications" : "team-registration"}
      className={`panel ${styles.portal}`}
      aria-busy={busy}
    >
      <h2>
        {team
          ? state?.isOwner
            ? t("Urus permohonan", "Manage applications")
            : t("Sertai pasukan", "Join this team")
          : t("Daftar pasukan", "Register a team")}
      </h2>
      {state && (
        <div className={styles.session}>
          <span>
            {t("Disahkan sebagai", "Verified as")} <strong>{state.ign}</strong>
          </span>
          <button
            type="button"
            className="button small secondary"
            disabled={busy}
            onClick={() => send("/api/member-access", "DELETE")}
          >
            {t("Log keluar", "Sign out")}
          </button>
        </div>
      )}
      {!open && (
        <p className={styles.notice}>
          {t(
            "Pendaftaran dan perubahan roster kejohanan ini telah ditutup.",
            "Registration and roster changes for this tournament are closed.",
          )}
        </p>
      )}
      {!state ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void send(
              "/api/member-access",
              "POST",
              Object.fromEntries(new FormData(event.currentTarget)),
            );
          }}
        >
          <p className="muted">
            {t(
              "Sahkan maklumat ahli untuk menyemak kelulusan kejohanan dan mengurus pasukan. Maklumat peribadi tidak dipaparkan pada halaman pasukan.",
              "Verify your member details to check tournament approval and manage your team. Private details are never shown on team pages.",
            )}
          </p>
          <fieldset disabled={busy}>
            <label>
              {t("Nama dalam game (IGN)", "In-game name (IGN)")}
              <input name="ign" required maxLength={80} autoComplete="off" />
            </label>
            <label>
              {t("ID TikTok berdaftar", "Registered TikTok ID")}
              <input
                name="tiktokId"
                required
                maxLength={80}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <button className="button" type="submit">
              {busy
                ? t("Mengesahkan…", "Verifying…")
                : t("Sahkan & teruskan", "Verify & continue")}
            </button>
          </fieldset>
        </form>
      ) : !state.approved ? (
        <div className={styles.notice}>
          <strong>
            {participationStatus && participationStatus !== "OPEN"
              ? t("Pendaftaran ditutup", "Registration closed")
              : t(
                  "Menunggu kelulusan kejohanan",
                  "Awaiting tournament approval",
                )}
          </strong>
          <p>
            {participationStatus && participationStatus !== "OPEN"
              ? participationStatus === "FULL"
                ? t(
                    "Semua slot pemain kejohanan telah diisi. Permohonan baharu untuk SOLO & TEAM telah ditutup.",
                    "All tournament player slots are filled. New applications for SOLO & TEAM are closed.",
                  )
                : t(
                    "Pendaftaran kejohanan ini tidak tersedia atau telah ditutup. Hubungi moderator.",
                    "Tournament registration is unavailable or closed. Contact a moderator.",
                  )
              : participationStatus === "OPEN"
                ? t(
                    "Hantar penyertaan kejohanan. Ahli aktif yang sepadan dengan rekod diluluskan secara automatik selagi slot tersedia.",
                    "Submit your tournament application. Matching active members are automatically approved while slots are available.",
                  )
                : t(
                    "Kelulusan ahli sahaja belum mencukupi. Moderator perlu meluluskan slot kejohanan anda sebelum anda boleh cipta atau sertai pasukan.",
                    "Member approval alone is not enough. A moderator must approve your tournament slot before you can create or join a team.",
                  )}
          </p>
          {participationStatus === "OPEN" && (
            <Link className="text-link" href={`/participate/${slug}`}>
              {t(
                "Mohon penyertaan kejohanan ↗",
                "Apply for tournament participation ↗",
              )}
            </Link>
          )}
        </div>
      ) : team ? (
        <>
          {state.isOwner ? (
            <>
              <p className="muted">
                {t(
                  "Pemohon hanya menyertai roster selepas anda luluskan. Pasukan terhad kepada empat pemain termasuk pemilik.",
                  "Applicants join the roster only after you approve them. Teams have four places, including the owner.",
                )}
              </p>
              <h3>
                {t("Permohonan menunggu", "Pending applications")} (
                {state.requests.length})
              </h3>
              {state.requests.length ? (
                <ul className={styles.requests}>
                  {state.requests.map((request) => (
                    <li className={styles.request} key={request.id}>
                      <strong>{request.ign}</strong>
                      <div className={styles.actions}>
                        <button
                          className="button small"
                          disabled={busy || !open || team.playerCount >= 4}
                          onClick={() =>
                            action(
                              {
                                action: "APPROVE",
                                teamSlug: team.slug,
                                applicationId: request.id,
                              },
                              t(
                                "Pemohon diluluskan dan ditambah ke roster.",
                                "Applicant approved and added to the roster.",
                              ),
                            )
                          }
                        >
                          {t("Luluskan", "Approve")}
                        </button>
                        <button
                          className="button small secondary"
                          disabled={busy || !open}
                          onClick={() =>
                            action(
                              {
                                action: "REJECT",
                                teamSlug: team.slug,
                                applicationId: request.id,
                              },
                              t("Permohonan ditolak.", "Application rejected."),
                            )
                          }
                        >
                          {t("Tolak", "Reject")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.notice}>
                  {t(
                    "Belum ada permohonan menunggu.",
                    "No pending applications yet.",
                  )}
                </p>
              )}
            </>
          ) : state.teamSlug ? (
            <p className={styles.notice}>
              {state.teamSlug === team.slug
                ? t(
                    "Anda adalah ahli pasukan ini.",
                    "You are a member of this team.",
                  )
                : t(
                    "Anda sudah menyertai pasukan lain dalam kejohanan ini.",
                    "You already belong to another team in this tournament.",
                  )}{" "}
              <Link className="text-link" href={`${base}/${state.teamSlug}`}>
                {t("Pasukan anda ↗", "Your team ↗")}
              </Link>
            </p>
          ) : state.application ? (
            <p className={styles.notice} role="status">
              {state.application === "PENDING"
                ? t(
                    "Permohonan dihantar — menunggu kelulusan pemilik pasukan.",
                    "Application submitted — pending team owner approval.",
                  )
                : state.application === "REJECTED"
                  ? t(
                      "Permohonan anda ditolak atau ditutup selepas menyertai pasukan lain. Anda boleh mohon kepada pasukan lain yang masih mempunyai tempat.",
                      "Your application was rejected or closed after joining another team. You can apply to another team with an open place.",
                    )
                  : t(
                      "Permohonan anda telah diluluskan. Hubungi moderator jika anda tidak disenaraikan dalam roster.",
                      "Your application was approved. Contact a moderator if you are missing from the roster.",
                    )}
            </p>
          ) : (
            <>
              <p className="muted">
                {t(
                  "Penyertaan kejohanan anda telah diluluskan. Hantar permohonan untuk disemak oleh pemilik pasukan.",
                  "Your tournament participation is approved. Send an application for the team owner to review.",
                )}
              </p>
              <button
                className="button"
                disabled={
                  busy ||
                  !open ||
                  !team.acceptsApplications ||
                  team.playerCount >= 4
                }
                onClick={() =>
                  action(
                    { action: "APPLY", teamSlug: team.slug },
                    t(
                      "Permohonan dihantar. Menunggu kelulusan pemilik.",
                      "Application submitted. Awaiting owner approval.",
                    ),
                  )
                }
              >
                {team.playerCount >= 4
                  ? t("Pasukan penuh", "Team full")
                  : !team.acceptsApplications
                    ? t("Permohonan ditutup", "Applications closed")
                    : t("Mohon sertai pasukan", "Apply to team")}
              </button>
            </>
          )}
        </>
      ) : state.teamSlug ? (
        <p className={styles.notice}>
          {t(
            "Anda sudah mempunyai pasukan untuk kejohanan ini.",
            "You already have a team in this tournament.",
          )}{" "}
          <Link className="text-link" href={`${base}/${state.teamSlug}`}>
            {t("Buka pasukan anda ↗", "Open your team ↗")}
          </Link>
        </p>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            fields.set("action", "CREATE");
            void send(`/api/teams/${slug}`, "POST", fields);
          }}
        >
          <p className="muted">
            {t(
              "Anda akan menjadi pemilik dan pemain pertama. Pasukan akan terus disenaraikan di halaman utama supaya pemain lain yang diluluskan boleh memohon.",
              "You will be the owner and first player. Your team will appear on the landing page so other approved players can apply.",
            )}
          </p>
          <fieldset disabled={busy || !open}>
            <label>
              {t("Nama pasukan", "Team name")}
              <input
                name="name"
                autoComplete="off"
                required
                minLength={2}
                maxLength={80}
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
              />
            </label>
            <div className={styles.imageUpload}>
              <TeamAvatar image={imagePreview} name={teamName} />
              <div className={styles.imageFields}>
                <label>
                  {t("Imej pasukan (pilihan)", "Team image (optional)")}
                  <input
                    ref={imageInput}
                    name="image"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-describedby="team-image-help"
                    onChange={(event) => {
                      setError("");
                      const selected = event.target.files?.[0] ?? null;
                      const invalid = selected
                        ? teamImageError(selected)
                        : undefined;
                      if (invalid) {
                        event.target.value = "";
                        setImageFile(null);
                        setError(t(...messages[invalid]));
                      } else setImageFile(selected);
                    }}
                  />
                </label>
                <p id="team-image-help" className="muted text-sm">
                  {t(
                    "PNG, JPEG atau WebP sehingga 4 MB. Imej dipotong dan dikecilkan kepada avatar bulat 64 × 64 px.",
                    "PNG, JPEG or WebP up to 4 MB. Cropped and resized to a circular 64 × 64 px avatar.",
                  )}
                </p>
                {imageFile && (
                  <button
                    className="button small secondary"
                    type="button"
                    onClick={() => {
                      setImageFile(null);
                      if (imageInput.current) imageInput.current.value = "";
                    }}
                  >
                    {t("Buang imej", "Remove image")}
                  </button>
                )}
              </div>
            </div>
            <button className="button" type="submit">
              {busy
                ? t("Mendaftar…", "Registering…")
                : t("Daftar pasukan", "Register team")}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
