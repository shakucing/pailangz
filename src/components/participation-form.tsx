"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { useLocale } from "./locale-context";
import styles from "./registration-form.module.css";
import participation from "./participation-form.module.css";
import { NavigationLink as Link } from "./navigation-link";
import type { ParticipationStatus } from "@/lib/participation-status";
import {
  participationProfileFields,
  type ParticipationProfileField,
} from "@/lib/participation-profile";

export function ParticipationClosed({
  status,
  slug,
  focus = false,
  format,
}: {
  status: Exclude<ParticipationStatus, "OPEN">;
  slug: string;
  focus?: boolean;
  format?: "SOLO" | "TEAM" | null;
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
              "Semua slot pemain kejohanan telah diisi. Permohonan baharu untuk kejohanan ini telah ditutup.",
              "All tournament player slots are filled. New applications for this tournament are closed.",
            )
          : t(
              "Pendaftaran kejohanan ini tidak tersedia atau telah ditutup. Hubungi moderator untuk maklumat lanjut.",
              "Tournament registration is unavailable or closed. Contact a moderator for more information.",
            )}
      </p>
      {format !== "SOLO" && (
        <Link className="button secondary" href={`/tournaments/${slug}/teams`}>
          {t("Lihat pasukan", "Browse teams")}
        </Link>
      )}
    </section>
  );
}

export function ParticipationForm({
  slug,
  format,
  teamRosterManagement = "PLAYER",
}: {
  slug: string;
  format?: "SOLO" | "TEAM" | null;
  teamRosterManagement?: "PLAYER" | "STAFF";
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<ParticipationProfileField[] | null>(
    null,
  );
  const profileHeading = useRef<HTMLHeadingElement>(null);
  const [review, setReview] = useState(false);
  const [reviewDetails, setReviewDetails] = useState({ ign: "", gmcId: "" });
  const [consents, setConsents] = useState({ terms: false, ign: false });
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

  useEffect(() => {
    if (missing !== null && !invalidFields.length)
      profileHeading.current?.focus();
  }, [missing, review]);

  if (submitted)
    return (
      <section className={`panel ${styles.success}`} aria-live="polite">
        <CheckCircle2 size={44} aria-hidden="true" />
        <h2 ref={confirmation} tabIndex={-1}>
          {t("Penyertaan diluluskan.", "Participation approved.")}
        </h2>
        <p className="muted">
          {t(
            `IGN dan ID TikTok anda sepadan dengan rekod ahli aktif. Penyertaan ${format ?? "SOLO & TEAM"} anda telah diluluskan.`,
            `Your IGN and TikTok ID match your active member record. Your ${format ?? "SOLO & TEAM"} tournament entry is approved.`,
          )}
          {format !== "SOLO" &&
            teamRosterManagement === "STAFF" &&
            t(
              " Pihak staf akan menetapkan anda ke pasukan. Anda boleh melihat roster selepas penetapan dibuat.",
              " Staff will assign you to a team. You can view the rosters once assignments are made.",
            )}
          {format !== "SOLO" &&
            teamRosterManagement === "PLAYER" &&
            t(
              " Anda boleh daftar pasukan atau mohon sertai pasukan.",
              " You can now register a team or apply to join one.",
            )}
        </p>
        {format !== "SOLO" && (
          <Link
            className="button secondary"
            href={`/tournaments/${slug}/teams`}
          >
            {t("Lihat pasukan", "Browse teams")}
          </Link>
        )}
      </section>
    );

  if (closed)
    return (
      <ParticipationClosed status={closed} slug={slug} format={format} focus />
    );

  function field(
    name: "ign" | "tiktokId" | ParticipationProfileField,
    label: string,
    options: {
      help?: string;
      maxLength?: number;
      placeholder?: string;
      type?: string;
      autoComplete?: string;
      readOnly?: boolean;
    } = {},
  ) {
    const invalid = invalidFields.includes(name);
    return (
      <div className={styles.field}>
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
          maxLength={options.maxLength ?? 100}
          type={options.type ?? "text"}
          autoComplete={options.autoComplete ?? "off"}
          autoCapitalize="none"
          spellCheck={false}
          readOnly={options.readOnly}
          placeholder={options.placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={
            options.help || invalid ? `participation-${name}-help` : undefined
          }
          onChange={() => {
            setError("");
            setInvalidFields((current) =>
              current.filter((field) => field !== name),
            );
          }}
        />
        {(options.help || invalid) && (
          <p
            id={`participation-${name}-help`}
            className={invalid ? styles.fieldError : styles.help}
          >
            {invalid
              ? t(
                  "Sila semak dan lengkapkan medan ini.",
                  "Please check and complete this field.",
                )
              : options.help}
          </p>
        )}
      </div>
    );
  }

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
        const values = new FormData(event.currentTarget);
        if (missing !== null && !review) {
          setReviewDetails({
            ign: String(values.get("ign") ?? ""),
            gmcId: String(values.get("gmcId") ?? ""),
          });
          setReview(true);
          return;
        }
        sending.current = true;
        const fields = {
          ign: values.get("ign"),
          tiktokId: values.get("tiktokId"),
          action: missing === null ? "CHECK" : "SUBMIT",
          soloTermsRead: values.get("soloTermsRead") === "on",
          soloIgnDisplayConsent: values.get("soloIgnDisplayConsent") === "on",
          profile: Object.fromEntries(
            participationProfileFields
              .filter((field) => values.has(field.name))
              .map((field) => [field.name, values.get(field.name)]),
          ),
        };
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
          if (response.ok && Array.isArray(data.missingFields)) {
            setReviewDetails({ ign: String(fields.ign ?? ""), gmcId: "" });
            if (data.missingFields.length === 0) setReview(true);
            setMissing(
              participationProfileFields
                .filter((field) => data.missingFields.includes(field.name))
                .map((field) => field.name),
            );
            return;
          }
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
          if (
            missing !== null &&
            data.error === "VALIDATION" &&
            data.fields?.some((name: string) =>
              participationProfileFields.some((field) => field.name === name),
            )
          ) {
            setReview(false);
            setMissing((current) => [
              ...new Set([
                ...(current ?? []),
                ...participationProfileFields
                  .filter((field) => data.fields?.includes(field.name))
                  .map((field) => field.name),
              ]),
            ]);
          }
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
                        "Sila semak dan lengkapkan medan yang ditandakan.",
                        "Please check and complete the highlighted fields.",
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
        <strong>{format ?? "SOLO & TEAM"}</strong>
        <span>{t("Penyertaan kejohanan", "Tournament entry")}</span>
      </div>
      <ol
        className={participation.steps}
        aria-label={t("Langkah pendaftaran", "Registration steps")}
      >
        <li aria-current={!review ? "step" : undefined}>
          <span>1</span>
          {t("Maklumat pemain", "Player details")}
        </li>
        <li aria-current={review ? "step" : undefined}>
          <span>2</span>
          {t("Sahkan penyertaan", "Confirm participation")}
        </li>
      </ol>
      <div className={styles.intro}>
        <h2 ref={profileHeading} tabIndex={-1}>
          {review
            ? t("Sahkan penyertaan anda", "Confirm your entry")
            : missing === null
              ? t("Sahkan rekod ahli anda", "Verify your member record")
              : missing.length
                ? t("Lengkapkan maklumat anda", "Complete your details")
                : t("Maklumat anda lengkap", "Your details are complete")}
        </h2>
        <p className="muted" role="status">
          {review
            ? t(
                "Semak penyertaan anda sebelum menghantar. Maklumat baharu akan disimpan bersama pendaftaran ini.",
                "Review your entry before submitting. New details will be saved with this registration.",
              )
            : missing === null
              ? t(
                  "Masukkan IGN dan ID TikTok anda untuk menyemak maklumat yang diperlukan.",
                  "Enter your IGN and TikTok ID to check which details are needed.",
                )
              : missing.length
                ? t(
                    `Sila lengkapkan ${missing.length} maklumat yang belum disimpan sebelum mendaftar. Maklumat sedia ada tidak perlu diisi semula.`,
                    `Please complete ${missing.length} missing details before registering. Saved details do not need to be entered again.`,
                  )
                : t(
                    "Semua maklumat yang diperlukan telah disimpan. Anda boleh sahkan penyertaan.",
                    "All required details are saved. You can confirm your entry.",
                  )}
        </p>
      </div>
      <fieldset className={styles.group} disabled={busy} hidden={review}>
        <legend>
          <span>01</span> {t("Maklumat pemain", "Player details")}
        </legend>
        <div className={participation.fields}>
          {field("ign", t("Nama dalam game (IGN)", "In-game name (IGN)"), {
            help: t(
              "Gunakan IGN yang sama seperti dalam rekod ahli.",
              "Use the same IGN as your member record.",
            ),
            maxLength: 80,
            readOnly: missing !== null,
          })}
          {missing?.includes("gmcId") &&
            field("gmcId", "ID GMC", {
              placeholder: t("Masukkan ID GMC anda", "Enter your GMC ID"),
            })}
          {field("tiktokId", t("ID TikTok", "TikTok ID"), {
            help: t(
              "Masukkan ID TikTok yang disimpan, contohnya @namaanda. Jangan gunakan nama paparan.",
              "Enter your saved TikTok ID, e.g. @yourname. Use your ID rather than your display name.",
            ),
            maxLength: 80,
            readOnly: missing !== null,
          })}
        </div>
        {missing !== null && (
          <button
            type="button"
            className={`button secondary ${participation.changeMember}`}
            onClick={() => {
              setMissing(null);
              setReview(false);
              setConsents({ terms: false, ign: false });
              setInvalidFields([]);
              setError("");
            }}
          >
            {t("Tukar ahli", "Change member")}
          </button>
        )}
      </fieldset>
      {missing?.some((name) => name === "email" || name === "whatsapp") && (
        <fieldset className={styles.group} disabled={busy} hidden={review}>
          <legend>
            <span>02</span> {t("Maklumat hubungan", "Contact details")}
          </legend>
          <div className={styles.fields}>
            {missing.includes("email") &&
              field("email", "Email", {
                type: "email",
                autoComplete: "email",
                maxLength: 254,
                placeholder: "nama@example.com",
              })}
            {missing.includes("whatsapp") &&
              field("whatsapp", t("Nombor WhatsApp", "WhatsApp number"), {
                type: "tel",
                autoComplete: "tel",
                maxLength: 80,
                placeholder: "+60 12 345 6789",
              })}
          </div>
        </fieldset>
      )}
      {missing?.some(
        (name) => name === "discordName" || name === "discordId",
      ) && (
        <fieldset className={styles.group} disabled={busy} hidden={review}>
          <legend>
            <span>03</span> Discord
          </legend>
          <div className={styles.fields}>
            {missing.includes("discordName") &&
              field(
                "discordName",
                t("Nama pengguna Discord", "Discord username"),
                {
                  placeholder: "Atrh ✨",
                  help: t(
                    "Nama yang dipaparkan pada profil Discord anda.",
                    "The name displayed on your Discord profile.",
                  ),
                },
              )}
            {missing.includes("discordId") &&
              field("discordId", t("ID Discord", "Discord ID"), {
                placeholder: "atrh0222",
                help: t(
                  "Nama pengguna di bawah nama paparan. Contoh: atrh0222.",
                  "The username below your display name. Example: atrh0222.",
                ),
              })}
          </div>
        </fieldset>
      )}
      {review && (
        <dl className={participation.review}>
          <div>
            <dt>{t("Nama dalam game (IGN)", "In-game name (IGN)")}</dt>
            <dd>{reviewDetails.ign}</dd>
          </div>
          <div>
            <dt>ID GMC</dt>
            <dd>
              {reviewDetails.gmcId ||
                t("Disimpan dalam profil", "Saved in profile")}
            </dd>
          </div>
          <div>
            <dt>{t("Kategori", "Category")}</dt>
            <dd>{format ?? "SOLO & TEAM"}</dd>
          </div>
        </dl>
      )}
      <div className={styles.footer}>
        {review && format === "SOLO" && (
          <>
            <label className={participation.terms}>
              <input
                type="checkbox"
                name="soloTermsRead"
                checked={consents.terms}
                onChange={(event) =>
                  setConsents((current) => ({
                    ...current,
                    terms: event.target.checked,
                  }))
                }
                required
                disabled={busy}
              />
              <span>
                {t("Saya telah membaca ", "I have read the ")}
                <Link href="/solo" target="_blank" rel="noopener noreferrer">
                  {t("terma dan syarat", "terms and conditions")}
                  <span className="sr-only">
                    {t(" (dibuka dalam tab baharu)", " (opens in a new tab)")}
                  </span>
                </Link>
                {t(" kejohanan Solo.", " of the Solo tournament.")}{" "}
                <span className={styles.required} aria-hidden="true">
                  *
                </span>
              </span>
            </label>
            <label className={participation.terms}>
              <input
                type="checkbox"
                name="soloIgnDisplayConsent"
                checked={consents.ign}
                onChange={(event) =>
                  setConsents((current) => ({
                    ...current,
                    ign: event.target.checked,
                  }))
                }
                required
                disabled={busy}
              />
              <span>
                {t(
                  "Saya bersetuju nama dalam game (IGN) saya dipaparkan secara awam apabila kejohanan diterbitkan.",
                  "I agree to my in-game name (IGN) being displayed publicly when the tournament is published.",
                )}{" "}
                <span className={styles.required} aria-hidden="true">
                  *
                </span>
              </span>
            </label>
          </>
        )}
        <p className={styles.privacy}>
          <ShieldCheck size={18} aria-hidden="true" />
          {t(
            "ID TikTok digunakan untuk padanan rekod. Maklumat yang dilengkapkan akan disimpan dalam profil anda untuk pendaftaran seterusnya. Maklumat hubungan dan sosial hanya boleh dilihat oleh moderator dan admin yang dibenarkan.",
            "Your TikTok ID is used to match your record. Completed details are saved to your profile for future registrations. Contact and social details are visible only to authorized moderators and admins.",
          )}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {review && (
          <button
            type="button"
            className={`button secondary ${participation.back}`}
            disabled={busy}
            onClick={() => {
              setReview(false);
              setError("");
              setInvalidFields([]);
            }}
          >
            {t("Kembali ke maklumat pemain", "Back to player details")}
          </button>
        )}
        <button className="button" type="submit" disabled={busy}>
          {busy
            ? t("Mengesahkan…", "Verifying…")
            : missing === null
              ? t("Semak maklumat ahli", "Check member details")
              : !review
                ? t("Teruskan", "Continue")
                : t("Sahkan penyertaan", "Confirm participation")}
          {!busy && <ArrowRight size={17} aria-hidden="true" />}
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
