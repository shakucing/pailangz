"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useLocale } from "./locale-context";
import styles from "./registration-form.module.css";
import participation from "./participation-form.module.css";
import { NavigationLink as Link } from "./navigation-link";
import type { ParticipationStatus } from "@/lib/participation-status";

export function ParticipationClosed({
  status,
  slug,
  focus = false,
}: {
  status: Exclude<ParticipationStatus, "OPEN">;
  slug: string;
  focus?: boolean;
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  return (
    <section className={`panel ${styles.success}`} role="status">
      <h2 ref={heading} tabIndex={-1}>
        {t("Pendaftaran ditutup", "Registration closed")}
      </h2>
      <p className="muted">
        {status === "FULL"
          ? t(
              "Semua slot pemain kejohanan telah diisi. Permohonan baharu untuk SOLO & TEAM telah ditutup.",
              "All tournament player slots are filled. New applications for SOLO & TEAM are closed.",
            )
          : t(
              "Pendaftaran kejohanan ini tidak tersedia atau telah ditutup. Hubungi moderator untuk maklumat lanjut.",
              "Tournament registration is unavailable or closed. Contact a moderator for more information.",
            )}
      </p>
      <Link className="button secondary" href={`/tournaments/${slug}/teams`}>
        {t("Lihat pasukan", "Browse teams")}
      </Link>
    </section>
  );
}

export function ParticipationForm({ slug }: { slug: string }) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [closed, setClosed] = useState<Exclude<
    ParticipationStatus,
    "OPEN"
  > | null>(null);
  const [error, setError] = useState("");
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const sending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (submitted) confirmation.current?.focus();
  }, [submitted]);
  useEffect(() => {
    if (busy || !invalidFields.length) return;
    const control = form.current?.elements.namedItem(invalidFields[0]);
    if (control instanceof HTMLElement) control.focus();
  }, [busy, invalidFields]);

  if (submitted)
    return (
      <section className={`panel ${styles.success}`} aria-live="polite">
        <CheckCircle2 size={44} aria-hidden="true" />
        <h2 ref={confirmation} tabIndex={-1}>
          {t("Penyertaan diluluskan.", "Participation approved.")}
        </h2>
        <p className="muted">
          {t(
            "IGN dan ID TikTok anda sepadan dengan rekod ahli aktif. Slot kejohanan SOLO & TEAM anda telah diluluskan secara automatik. Anda boleh terus daftar pasukan atau mohon sertai pasukan.",
            "Your IGN and TikTok ID match your active member record. Your SOLO & TEAM tournament slot is automatically approved. You can now register a team or apply to join one.",
          )}
        </p>
        <Link className="button secondary" href={`/tournaments/${slug}/teams`}>
          {t("Lihat pasukan", "Browse teams")}
        </Link>
      </section>
    );

  if (closed) return <ParticipationClosed status={closed} slug={slug} focus />;

  return (
    <form
      ref={form}
      className={`panel ${styles.form}`}
      method="post"
      action="/api/participation"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (sending.current) return;
        sending.current = true;
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        setError("");
        setInvalidFields([]);
        try {
          const response = await fetch("/api/participation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...fields, tournamentSlug: slug }),
          });
          const data = await response.json();
          if (response.ok && data.accepted) {
            setSubmitted(true);
            return;
          }
          // An open form can become stale while another player takes the last
          // slot. Replace it immediately when the server closes registration.
          if (data.error === "FULL" || data.error === "CLOSED") {
            setClosed(data.error);
            return;
          }
          setInvalidFields(data.fields ?? []);
          setError(
            data.error === "WITHDRAWN"
              ? t(
                  "Penyertaan anda telah ditarik balik. Hubungi moderator untuk menyertai semula.",
                  "Your entry was withdrawn. Contact a moderator to rejoin.",
                )
              : data.error === "VERIFICATION_FAILED"
                ? t(
                    "Maklumat tidak sepadan dengan rekod ahli yang diluluskan. Semak IGN dan ID TikTok anda, atau hubungi moderator.",
                    "The details do not match an approved member record. Check your IGN and TikTok ID, or contact a moderator.",
                  )
                : data.error === "RATE_LIMIT"
                  ? t(
                      "Terlalu banyak cubaan. Sila cuba semula dalam 10 minit.",
                      "Too many attempts. Please try again in 10 minutes.",
                    )
                  : data.error === "VALIDATION"
                    ? t(
                        "Sila semak dan lengkapkan kedua-dua medan.",
                        "Please check and complete both fields.",
                      )
                    : t(
                        "Penyertaan tidak dapat dihantar. Cuba lagi.",
                        "Unable to submit participation. Please try again.",
                      ),
          );
        } catch {
          setError(
            t(
              "Sambungan terputus. Cuba lagi; penyertaan tidak akan diduplikasi.",
              "Connection interrupted. Please retry; your entry will not be duplicated.",
            ),
          );
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      <div className={participation.included}>
        <strong>SOLO</strong>
        <strong>TEAM</strong>
        <span>{t("Kedua-duanya termasuk", "Both included")}</span>
      </div>
      <div className={participation.fields}>
        {(
          [
            [
              "ign",
              t("Nama dalam game (IGN)", "In-game name (IGN)"),
              t(
                "Gunakan IGN yang sama seperti dalam rekod ahli.",
                "Use the same IGN as your member record.",
              ),
            ],
            [
              "tiktokId",
              t("ID TikTok", "TikTok ID"),
              t(
                "Masukkan ID TikTok yang disimpan, contohnya @namaanda. Jangan gunakan nama paparan.",
                "Enter your saved TikTok ID, e.g. @yourname. Use your ID rather than your display name.",
              ),
            ],
          ] as const
        ).map(([name, label, help]) => (
          <div className={styles.field} key={name}>
            <label htmlFor={`participation-${name}`}>
              {label}{" "}
              <span className={styles.required} aria-hidden="true">
                *
              </span>
            </label>
            <input
              id={`participation-${name}`}
              name={name}
              required
              maxLength={80}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={invalidFields.includes(name) || undefined}
              aria-describedby={`participation-${name}-help`}
              onChange={() => {
                setError("");
                setInvalidFields((current) =>
                  current.filter((field) => field !== name),
                );
              }}
            />
            <p id={`participation-${name}-help`} className={styles.help}>
              {help}
            </p>
          </div>
        ))}
      </div>
      <div className={styles.footer}>
        <p className={styles.privacy}>
          <ShieldCheck size={18} aria-hidden="true" />
          {t(
            "ID TikTok digunakan untuk padanan rekod dan tidak dipaparkan secara awam. Ahli aktif yang sepadan diluluskan secara automatik selagi slot tersedia. Permohonan menyertai pasukan diluluskan oleh pemilik pasukan.",
            "Your TikTok ID is used to match your record and is never shown publicly. Matching active members are automatically approved while slots are available. Team owners approve requests to join their teams.",
          )}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={busy}>
          {busy
            ? t("Mengesahkan…", "Verifying…")
            : t("Sahkan penyertaan", "Confirm participation")}
        </button>
        <noscript>
          <p className={styles.help}>
            {t(
              "Aktifkan JavaScript untuk menghantar penyertaan.",
              "Enable JavaScript to submit your participation.",
            )}
          </p>
        </noscript>
      </div>
    </form>
  );
}
