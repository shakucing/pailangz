"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { useLocale } from "./locale-context";
import styles from "./registration-form.module.css";

type FieldName =
  | "ign"
  | "whatsapp"
  | "tiktokUsername"
  | "tiktokId"
  | "discordName"
  | "discordId"
  | "stateProvince"
  | "country";

export function RegistrationForm({
  countries,
}: {
  countries: { code: string; name: string }[];
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const requestId = useRef<string | null>(null);
  const sending = useRef(false);
  const focusInvalid = useRef(false);
  const confirmation = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (submitted) confirmation.current?.focus();
  }, [submitted]);
  useEffect(() => {
    if (busy || !focusInvalid.current || !invalidFields.length) return;
    focusInvalid.current = false;
    const first = formRef.current?.elements.namedItem(invalidFields[0]);
    if (first instanceof HTMLElement) first.focus();
  }, [busy, invalidFields]);

  if (submitted) {
    return (
      <section className={`panel ${styles.success}`} aria-live="polite">
        <CheckCircle2 size={44} aria-hidden="true" />
        <span className="eyebrow">
          {t("Langkah pertama selesai", "First step complete")}
        </span>
        <h2 ref={confirmation} tabIndex={-1}>
          {t("Permohonan diterima.", "Application received.")}
        </h2>
        <p className="muted">
          {t(
            "Moderator akan menyemak maklumat kau. Kelulusan ahli dan penyertaan kejohanan diproses secara berasingan.",
            "A moderator will review your details. Membership approval and tournament entry are handled separately.",
          )}
        </p>
        <a href="/" className="button secondary">
          {t("Kembali ke halaman utama", "Back to home")}{" "}
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </section>
    );
  }

  function field(
    name: FieldName,
    label: string,
    options: {
      required?: boolean;
      maxLength?: number;
      placeholder?: string;
      help?: string;
      type?: string;
      autoComplete?: string;
    } = {},
  ) {
    const invalid = invalidFields.includes(name);
    return (
      <div className={styles.field}>
        <label htmlFor={`registration-${name}`}>
          {label}
          {options.required ? (
            <span className={styles.required} aria-hidden="true">
              {" "}
              *
            </span>
          ) : (
            <span className={styles.optional}>{t("Pilihan", "Optional")}</span>
          )}
        </label>
        <input
          id={`registration-${name}`}
          name={name}
          type={options.type ?? "text"}
          required={options.required}
          maxLength={options.maxLength ?? 100}
          placeholder={options.placeholder}
          autoComplete={options.autoComplete ?? "off"}
          aria-invalid={invalid || undefined}
          aria-describedby={
            options.help || invalid ? `registration-${name}-help` : undefined
          }
          onChange={() =>
            setInvalidFields((fields) => fields.filter((key) => key !== name))
          }
        />
        {(options.help || invalid) && (
          <p
            id={`registration-${name}-help`}
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
      ref={formRef}
      method="post"
      action="/api/registration"
      className={`panel ${styles.form}`}
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (sending.current) return;
        const form = event.currentTarget;
        const values = Object.fromEntries(new FormData(form));
        requestId.current ??= crypto.randomUUID();
        sending.current = true;
        setBusy(true);
        setError("");
        setInvalidFields([]);
        try {
          const response = await fetch("/api/registration", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...values, requestId: requestId.current }),
          });
          const result = await response.json();
          if (!response.ok) {
            if (result.error === "VALIDATION") {
              const fields = Array.isArray(result.fields) ? result.fields : [];
              focusInvalid.current = fields.length > 0;
              setInvalidFields(fields);
              setError(
                t(
                  "Sila semak medan yang ditandakan sebelum menghantar.",
                  "Please check the highlighted fields before submitting.",
                ),
              );
            } else {
              setError(
                result.error === "RATE_LIMIT"
                  ? t(
                      "Terlalu banyak percubaan. Sila cuba lagi kemudian.",
                      "Too many attempts. Please try again later.",
                    )
                  : t(
                      "Permohonan belum dapat dihantar. Maklumat kau masih di sini; sila cuba lagi.",
                      "Your application could not be submitted. Your details are still here; please try again.",
                    ),
              );
            }
            return;
          }
          setSubmitted(true);
        } catch {
          setError(
            t(
              "Sambungan terputus. Maklumat kau masih di sini; sila cuba lagi.",
              "The connection was interrupted. Your details are still here; please try again.",
            ),
          );
        } finally {
          sending.current = false;
          setBusy(false);
        }
      }}
    >
      <div className={styles.intro}>
        <span className="badge neutral">
          {t("Pendaftaran ahli", "Member registration")}
        </span>
        <h2>Pailangz Member</h2>
        <p className="muted">
          {t(
            "Kongsi maklumat permainan dan profil sosial kau.",
            "Share your gaming and social profile details.",
          )}
        </p>
        <p className={styles.help}>
          <span className={styles.required}>*</span>{" "}
          {t(
            "Wajib diisi: nama dalam game, nama pengguna TikTok, ID TikTok dan negara.",
            "Required: in-game name, TikTok username, TikTok ID and country.",
          )}
        </p>
      </div>

      <fieldset className={styles.group} disabled={busy}>
        <legend>
          <span>01</span> {t("Maklumat pemain", "Player details")}
        </legend>
        <div className={styles.fields}>
          {field("ign", t("Nama dalam game (IGN)", "In-game name (IGN)"), {
            required: true,
            maxLength: 80,
            placeholder: t("Nama kau dalam game", "Your name in game"),
            help: t(
              "Gunakan ejaan dan simbol yang sama seperti dalam game.",
              "Use the same spelling and symbols as in game.",
            ),
          })}
          {field("whatsapp", t("Nombor WhatsApp", "WhatsApp number"), {
            type: "tel",
            maxLength: 80,
            autoComplete: "tel",
            placeholder: "+60 12 345 6789",
          })}
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={busy}>
        <legend>
          <span>02</span> TikTok
        </legend>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>
            {t("Contoh profil", "Profile example")}
          </span>
          <div>
            <strong>Nur Athirah</strong>
            <span>{t("← Nama pengguna", "← Username / display name")}</span>
          </div>
          <div>
            <code>@atrhh_98</code>
            <span>← {t("ID TikTok", "TikTok ID")}</span>
          </div>
        </div>
        <div className={styles.fields}>
          {field(
            "tiktokUsername",
            t("Nama pengguna TikTok", "TikTok username"),
            {
              required: true,
              placeholder: "Nur Athirah",
              help: t(
                "Nama yang dipaparkan di bahagian atas profil TikTok kau.",
                "The display name at the top of your TikTok profile.",
              ),
            },
          )}
          {field("tiktokId", t("ID TikTok", "TikTok ID"), {
            required: true,
            maxLength: 80,
            placeholder: "@atrhh_98",
            help: t(
              "ID / handle di bawah nama profil kau, bermula dengan @.",
              "The ID / handle below your profile name, starting with @.",
            ),
          })}
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={busy}>
        <legend>
          <span>03</span> Discord <small>{t("Pilihan", "Optional")}</small>
        </legend>
        <div className={styles.fields}>
          {field("discordName", t("Nama Discord", "Discord name"), {
            placeholder: "Atrh ✨",
            help: t(
              "Nama paparan kau. Contoh: Atrh ✨.",
              "Your display name. Example: Atrh ✨.",
            ),
          })}
          {field("discordId", t("ID Discord", "Discord ID"), {
            placeholder: "atrh0222",
            help: t(
              "Nama pengguna di bawah nama paparan. Contoh: atrh0222.",
              "The username below your display name. Example: atrh0222.",
            ),
          })}
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={busy}>
        <legend>
          <span>04</span> {t("Lokasi", "Location")}
        </legend>
        <div className={styles.fields}>
          {field("stateProvince", t("Negeri / Wilayah", "State / Province"), {
            autoComplete: "address-level1",
            placeholder: t("Contoh: Selangor", "e.g. Selangor"),
          })}
          <div className={styles.field}>
            <label htmlFor="registration-country">
              {t("Negara", "Country")}{" "}
              <span className={styles.required} aria-hidden="true">
                *
              </span>
            </label>
            <select
              id="registration-country"
              name="country"
              required
              defaultValue=""
              autoComplete="country"
              aria-invalid={invalidFields.includes("country") || undefined}
              aria-describedby={
                invalidFields.includes("country")
                  ? "registration-country-help"
                  : undefined
              }
              onChange={() =>
                setInvalidFields((fields) =>
                  fields.filter((key) => key !== "country"),
                )
              }
            >
              <option value="" disabled>
                {t("Pilih negara kau", "Select your country")}
              </option>
              {countries.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            {invalidFields.includes("country") && (
              <p id="registration-country-help" className={styles.fieldError}>
                {t("Sila pilih negara kau.", "Please select your country.")}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <div className={styles.footer}>
        <p className={styles.privacy}>
          <ShieldCheck size={18} aria-hidden="true" />{" "}
          {t(
            "Maklumat hubungan, sosial dan lokasi kau hanya boleh dilihat oleh moderator dan admin yang dibenarkan.",
            "Your contact, social and location details are visible only to authorized moderators and admins.",
          )}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={busy}>
          {busy
            ? t("Sedang menghantar…", "Submitting…")
            : t("Hantar permohonan", "Submit application")}{" "}
          {!busy && <ArrowRight size={17} aria-hidden="true" />}
        </button>
        <p className={styles.help}>
          {t(
            "Pendaftaran ini tidak mencipta akaun staff atau memberikan akses moderator.",
            "Registration does not create a staff account or grant moderator access.",
          )}
        </p>
      </div>
    </form>
  );
}
