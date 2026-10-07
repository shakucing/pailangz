"use client";
import { useState, useId, useEffect } from "react";
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
import { evidenceSizeError } from "@/lib/evidence-policy";
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
  const [decision, setDecision] = useState(
    String(
      fixed.action ?? fields.find((f) => f.name === "action")?.value ?? "",
    ),
  );
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
            text: "Saved.",
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
          const required =
            f.required ||
            (action === "resultReview" &&
              f.name === "reason" &&
              ["REJECT", "DISPUTE"].includes(decision));
          if (f.type === "members")
            return (
              <SelectionField
                key={f.name}
                name={f.name}
                label={f.name === "reason" && required ? "Reason" : f.label}
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
                label={f.name === "reason" && required ? "Reason" : f.label}
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
                label={f.name === "reason" && required ? "Reason" : f.label}
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
                {f.name === "reason" && required ? "Reason" : f.label}
                {!required &&
                  !["checkbox", "select"].includes(f.type ?? "") && (
                    <span className="muted"> (optional)</span>
                  )}
              </span>
              {f.type === "textarea" ? (
                <textarea
                  id={`${uid}-${f.name}`}
                  name={f.name}
                  defaultValue={String(f.value ?? "")}
                  required={required}
                  minLength={f.name === "reason" && required ? 3 : undefined}
                  maxLength={f.name === "reason" ? 1000 : undefined}
                />
              ) : f.type === "select" ? (
                <select
                  id={`${uid}-${f.name}`}
                  name={f.name}
                  defaultValue={String(f.value ?? "")}
                  required={required}
                  onChange={
                    f.name === "action"
                      ? (e) => setDecision(e.target.value)
                      : undefined
                  }
                >
                  <option value="">
                    {required
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
                  required={required}
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
                  required={required}
                  placeholder={f.placeholder}
                  minLength={f.name === "reason" && required ? 3 : undefined}
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
        setFeedback("");
        const form = new FormData(e.currentTarget);
        form.set("action", action);
        if (resultId) form.set("resultId", resultId);
        try {
          const file = form.get("file");
          if (action === "evidence" && file instanceof File) {
            const sizeError = evidenceSizeError(file.size);
            if (sizeError) throw new Error(sizeError);
          }
          const r = await fetch("/api/staff", { method: "POST", body: form });
          if (r.status === 413)
            throw new Error(
              action === "evidence"
                ? "The screenshot is too large. Choose a PNG, JPEG or WebP up to 4 MB."
                : "The spreadsheet is too large. Choose a CSV up to 2 MB.",
            );
          const body = await r.json().catch(() => null);
          if (!r.ok || !body)
            throw new Error(body?.error ?? "Upload failed. Please try again.");
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
          : "Match screenshot (up to 4 MB)"}
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
  autoLoad = false,
}: {
  kind: "member" | "submission";
  id: string;
  autoLoad?: boolean;
}) {
  const [value, setValue] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "privateDetails", data: { kind, id } }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setValue(body.fields);
    } catch (e) {
      setError(
        friendlyError(
          e instanceof Error ? e.message : "Unable to load details.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (autoLoad) void load();
  }, [kind, id, autoLoad]);
  return (
    <div className="stack">
      {!autoLoad && !value && (
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={load}
        >
          {busy ? "Loading…" : "View registration details and phone"}
        </button>
      )}
      {autoLoad && busy && (
        <p role="status" className="muted text-sm">
          Loading details…
        </p>
      )}
      {value && (
        <dl className="readable-details">
          {Object.entries(value)
            .filter(([k]) => !/response[_ ]?id/i.test(k))
            .map(([k, v]) => (
              <div key={k}>
                <dt>{privateFieldLabel(k)}</dt>
                <dd className="break-all">{privateFieldValue(v)}</dd>
              </div>
            ))}
        </dl>
      )}
      {error && (
        <p className="feedback error" role="alert">
          {error}{" "}
          <button type="button" onClick={load}>
            Retry
          </button>
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
        Note (optional)
        <input
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
