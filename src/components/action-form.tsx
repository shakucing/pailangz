"use client";
import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import {
  SelectionField,
  OrderField,
  PairsField,
  RulesFields,
  MappingFields,
  SizesFields,
} from "./guided-fields";
import {
  activityCsv,
  privateFieldLabel,
  privateFieldValue,
  friendlyError,
  malaysiaDateInput,
  type Choice,
} from "@/lib/staff-presentation";
import { staffFormData } from "@/lib/staff-form";
import type { TournamentConfiguration } from "@/lib/tournament-config";
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "select"
    | "checkbox"
    | "members"
    | "ordered"
    | "pairs"
    | "configuration"
    | "rules"
    | "mapping"
    | "datetime-local"
    | "email"
    | "url";
  value?: unknown;
  required?: boolean;
  options?: Choice[];
  min?: number;
  max?: number;
  pairCount?: number;
  matchesPerPlayer?: number;
  complete?: boolean;
  confirmed?: string[];
  stageKey?: string;
  kind?: string;
  placeholder?: string;
  help?: string;
};
export function ActionForm({
  action,
  fields,
  fixed = {},
  label = "Save",
  compact = false,
}: {
  action: string;
  fields: Field[];
  fixed?: Record<string, unknown>;
  label?: string;
  compact?: boolean;
}) {
  const router = useRouter(),
    uid = useId();
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(
      null,
    );
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFeedback(null);
        try {
          const data = staffFormData(
            fields,
            new FormData(e.currentTarget),
            fixed,
          );
          const response = await fetch("/api/staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, data }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error);
          setFeedback({
            text: "Saved. Your change is recorded in activity history.",
            error: false,
          });
          router.refresh();
        } catch (error) {
          setFeedback({
            text:
              error instanceof Error
                ? friendlyError(error.message)
                : "Unable to save.",
            error: true,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="form-fields" disabled={busy}>
        {fields.map((f) => {
          if (f.type === "members")
            return (
              <SelectionField
                key={f.name}
                name={f.name}
                label={f.label}
                options={f.options ?? []}
                value={f.value as string[] | undefined}
                max={f.max}
                help={f.help}
              />
            );
          if (f.type === "ordered")
            return (
              <OrderField
                key={f.name}
                name={f.name}
                label={f.label}
                options={f.options ?? []}
                value={f.value as string[] | undefined}
                complete={f.complete}
                help={f.help}
              />
            );
          if (f.type === "pairs")
            return (
              <PairsField
                key={f.name}
                name={f.name}
                label={f.label}
                options={f.options ?? []}
                count={f.pairCount ?? 0}
                matchesPerPlayer={f.matchesPerPlayer}
              />
            );
          if (f.type === "configuration")
            return (
              <SizesFields
                key={f.name}
                configuration={f.value as TournamentConfiguration}
              />
            );
          if (f.type === "rules")
            return (
              <RulesFields
                key={f.name}
                rules={f.value as Record<string, unknown>}
                confirmed={f.confirmed ?? []}
                stageKey={f.stageKey}
                kind={f.kind}
              />
            );
          if (f.type === "mapping")
            return (
              <MappingFields
                key={f.name}
                value={f.value as Record<string, string>}
              />
            );
          return (
            <label
              key={f.name}
              htmlFor={`${uid}-${f.name}`}
              className={f.type === "checkbox" ? "choice-row" : undefined}
            >
              <span>
                {f.label}
                {!f.required &&
                  !["checkbox", "select"].includes(f.type ?? "") && (
                    <span className="muted"> (optional)</span>
                  )}
              </span>
              {f.type === "textarea" ? (
                <textarea
                  id={`${uid}-${f.name}`}
                  name={f.name}
                  defaultValue={String(f.value ?? "")}
                  required={f.required}
                />
              ) : f.type === "select" ? (
                <select
                  id={`${uid}-${f.name}`}
                  name={f.name}
                  defaultValue={String(f.value ?? "")}
                  required={f.required}
                >
                  <option value="">
                    {f.required
                      ? "Choose an option…"
                      : "Keep current / no selection"}
                  </option>
                  {f.options?.map((o) => (
                    <option value={o.value} key={o.value} disabled={o.disabled}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "checkbox" ? (
                <input
                  id={`${uid}-${f.name}`}
                  name={f.name}
                  type="checkbox"
                  defaultChecked={Boolean(f.value)}
                  required={f.required}
                />
              ) : (
                <input
                  id={`${uid}-${f.name}`}
                  name={f.name}
                  type={f.type ?? "text"}
                  defaultValue={
                    f.type === "datetime-local"
                      ? malaysiaDateInput(f.value as string)
                      : String(f.value ?? "")
                  }
                  required={f.required}
                  placeholder={f.placeholder}
                  minLength={f.name === "reason" ? 3 : undefined}
                  maxLength={f.name === "reason" ? 1000 : undefined}
                  aria-describedby={
                    f.help ? `${uid}-${f.name}-help` : undefined
                  }
                />
              )}
              {f.help && (
                <span id={`${uid}-${f.name}-help`} className="muted text-xs">
                  {f.help}
                </span>
              )}
              {f.type === "datetime-local" && (
                <span className="muted text-xs">Malaysia time</span>
              )}
            </label>
          );
        })}
      </fieldset>
      {feedback && (
        <div
          role={feedback.error ? "alert" : "status"}
          className={`feedback ${feedback.error ? "error" : ""}`}
        >
          {feedback.text}
        </div>
      )}
      <button
        disabled={busy}
        className={`button ${compact ? "small secondary" : ""}`}
        type="submit"
      >
        {busy ? "Saving…" : label}
      </button>
    </form>
  );
}
export function UploadForm({
  action,
  resultId,
}: {
  action: "import" | "evidence";
  resultId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState("");
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const form = new FormData(e.currentTarget);
        form.set("action", action);
        if (resultId) form.set("resultId", resultId);
        try {
          const r = await fetch("/api/staff", { method: "POST", body: form });
          const body = await r.json();
          if (!r.ok) throw new Error(body.error);
          setFeedback(
            action === "import"
              ? `Added ${body.created} registrations. ${body.skipped} already uploaded; ${body.conflicts} need a duplicate check.`
              : "Evidence uploaded.",
          );
          router.refresh();
        } catch (e) {
          setFeedback(
            e instanceof Error ? friendlyError(e.message) : "Upload failed.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {action === "import"
          ? "Registration spreadsheet (.csv)"
          : "Match screenshot (up to 5 MB)"}
        <input
          name="file"
          type="file"
          accept={
            action === "import" ? ".csv" : "image/png,image/jpeg,image/webp"
          }
          required
        />
      </label>
      <button disabled={busy} className="button secondary" type="submit">
        {busy
          ? "Uploading…"
          : action === "import"
            ? "Import into review inbox"
            : "Upload private evidence"}
      </button>
      {feedback && (
        <p className="feedback" role="status">
          {feedback}
        </p>
      )}
    </form>
  );
}
export function PrivateDetails({
  kind,
  id,
}: {
  kind: "member" | "submission";
  id: string;
}) {
  const [value, setValue] = useState<Record<string, unknown> | null>(null),
    [phone, setPhone] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState("");
  async function load(reveal: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: reveal ? "reveal" : "privateDetails",
          data: { kind, id, reason },
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (reveal) setPhone(body.phone ?? "No phone supplied.");
      else setValue(body.fields);
    } catch (e) {
      setError(
        e instanceof Error
          ? friendlyError(e.message)
          : "Unable to load details.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <button
        className="button secondary small"
        disabled={busy}
        onClick={() => load(false)}
      >
        View registration details
      </button>
      {value && (
        <dl className="text-sm space-y-3">
          {Object.entries(value)
            .filter(([k]) => !/response[_ ]?id/i.test(k))
            .map(([k, v]) => (
              <div key={k}>
                <dt className="muted text-xs">{privateFieldLabel(k)}</dt>
                <dd className="break-all m-0">{privateFieldValue(v)}</dd>
              </div>
            ))}
        </dl>
      )}
      <div className="form">
        <label>
          Why do you need the phone number?
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Registration verification"
          />
        </label>
        <button
          className="button secondary small"
          disabled={busy || reason.trim().length < 3}
          onClick={() => load(true)}
        >
          Show phone number
        </button>
      </div>
      {phone && (
        <p className="feedback" role="status">
          {phone}{" "}
          <button className="ml-3 underline" onClick={() => setPhone(null)}>
            Hide
          </button>
        </p>
      )}
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AuditExport() {
  const [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const r = await fetch("/api/staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "auditExport", data: { reason } }),
          });
          const body = await r.json();
          if (!r.ok) throw new Error(body.error);
          const url = URL.createObjectURL(
            new Blob([activityCsv(body.records)], {
              type: "text/csv;charset=utf-8",
            }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "pailangz-activity.csv";
          a.click();
          URL.revokeObjectURL(url);
          setMessage(
            `Downloaded ${body.records.length} activities. This download is recorded in the history.`,
          );
        } catch (e) {
          setMessage(
            e instanceof Error ? friendlyError(e.message) : "Export failed.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Reason for downloading activity history
        <input
          required
          minLength={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button className="button secondary" disabled={busy}>
        {busy
          ? "Exporting…"
          : "Download activity spreadsheet · up to 1,000 entries"}
      </button>
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
    </form>
  );
}
