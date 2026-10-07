"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TournamentConfiguration } from "@/lib/tournament-config";
import { SizesFields } from "./guided-fields";
import { staffFormData } from "@/lib/staff-form";
import { friendlyError } from "@/lib/staff-presentation";
export function TournamentConfigForm({
  id,
  configuration,
}: {
  id: string;
  configuration: TournamentConfiguration;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const form = new FormData(e.currentTarget);
          const config = staffFormData(
            [
              {
                name: "configuration",
                label: "Tournament sizes",
                type: "configuration",
              },
            ],
            form,
          ).configuration;
          const r = await fetch("/api/staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "configure",
              data: {
                id,
                configuration: config,
                regenerate: form.get("regenerate") === "on",
                reason: form.get("reason"),
              },
            }),
          });
          const body = await r.json();
          if (!r.ok) throw new Error(body.error);
          setMessage(
            body.status === "PENDING"
              ? "Update proposed. An admin needs to review how to restart the existing competition."
              : "Tournament sizes updated. Earlier matches stay in history. Confirm the rules for the new competition.",
          );
          router.refresh();
        } catch (e) {
          setMessage(
            e instanceof Error
              ? friendlyError(e.message)
              : "Unable to configure.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="form-fields" disabled={busy}>
        <SizesFields configuration={configuration} />
        <label>
          <input type="checkbox" name="regenerate" /> Create a fresh schedule
          and keep earlier matches in history. The tournament returns to a
          private draft and its rules need confirmation again.
        </label>
        <label>
          Note (required when restarting a published competition or existing
          results)
          <input name="reason" maxLength={1000} />
        </label>
      </fieldset>
      <button disabled={busy} className="button secondary">
        {busy ? "Saving…" : "Save tournament sizes"}
      </button>
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
