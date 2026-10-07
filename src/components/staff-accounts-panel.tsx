"use client";
import { useId, useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, UserPlus, Trash2 } from "lucide-react";

type StaffAccount = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MODERATOR";
  suspended: boolean;
};
async function save(action: string, data: Record<string, unknown>) {
  const response = await fetch("/api/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Please try again.");
}

export function AddStaffAccount() {
  const uid = useId(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [refreshing, startTransition] = useTransition();
  const [show, setShow] = useState(false),
    [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  return (
    <details className="panel account-create">
      <summary>
        <UserPlus size={18} aria-hidden="true" /> Add staff account
      </summary>
      <p className="muted text-sm">
        Create an admin or moderator. Every account change is recorded
        automatically.
      </p>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget,
            data = new FormData(form);
          const password = String(data.get("password") ?? "");
          setError("");
          setSuccess("");
          if (password !== data.get("confirmPassword")) {
            setError("The passwords do not match.");
            return;
          }
          if (new TextEncoder().encode(password).length > 72) {
            setError("Use at most 72 UTF-8 bytes for the password.");
            return;
          }
          setBusy(true);
          try {
            await save("staffCreate", {
              name: data.get("name"),
              email: data.get("email"),
              role: data.get("role"),
              password,
            });
            form.reset();
            setShow(false);
            setSuccess(
              "Staff account created. They can now sign in at /staff.",
            );
            startTransition(() => router.refresh());
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Unable to create account.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="form-fields" disabled={busy || refreshing}>
          <div className="grid2">
            <label htmlFor={`${uid}-name`}>
              Display name
              <input
                id={`${uid}-name`}
                name="name"
                maxLength={100}
                autoComplete="off"
                required
              />
            </label>
            <label htmlFor={`${uid}-email`}>
              Email
              <input
                id={`${uid}-email`}
                name="email"
                type="email"
                maxLength={254}
                autoComplete="off"
                required
              />
            </label>
          </div>
          <label htmlFor={`${uid}-role`}>
            Role
            <select id={`${uid}-role`} name="role" defaultValue="MODERATOR">
              <option value="MODERATOR">Moderator</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          <div className="grid2">
            <div className="password-control">
              <label htmlFor={`${uid}-password`}>Password</label>
              <span className="password-field">
                <input
                  id={`${uid}-password`}
                  name="password"
                  type={show ? "text" : "password"}
                  minLength={14}
                  maxLength={72}
                  autoComplete="new-password"
                  required
                  aria-describedby={`${uid}-password-help`}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
              <span id={`${uid}-password-help`} className="muted text-xs">
                At least 14 characters; at most 72 UTF-8 bytes.
              </span>
            </div>
            <label htmlFor={`${uid}-confirm`}>
              Confirm password
              <input
                id={`${uid}-confirm`}
                name="confirmPassword"
                type={show ? "text" : "password"}
                minLength={14}
                maxLength={72}
                autoComplete="new-password"
                required
              />
            </label>
          </div>
          <button className="button" type="submit">
            {busy
              ? "Creating account…"
              : refreshing
                ? "Updating list…"
                : "Create staff account"}
          </button>
        </fieldset>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="feedback" role="status">
            {success}
          </p>
        )}
      </form>
    </details>
  );
}

export function StaffAccountRow({
  account,
  current,
}: {
  account: StaffAccount;
  current: boolean;
}) {
  const uid = useId(),
    router = useRouter(),
    dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [refreshing, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  async function submit(action: string, data: Record<string, unknown>) {
    setBusy(true);
    setFeedback(null);
    try {
      await save(action, data);
      dialog.current?.close();
      setFeedback({
        error: false,
        text:
          action === "staffRemove"
            ? "Account deleted. Activity history retained."
            : "Account saved. Existing sessions signed out.",
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setFeedback({
        error: true,
        text: e instanceof Error ? e.message : "Unable to save.",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel account-row">
      <div className="account-heading">
        <div>
          <h3>
            {account.name}{" "}
            {current && <span className="badge neutral">You</span>}
          </h3>
          <p className="muted text-sm account-email">{account.email}</p>
        </div>
        <div className="row">
          <span className="badge neutral">
            {account.role === "ADMIN" ? "Admin" : "Moderator"}
          </span>
          <span className={`badge ${account.suspended ? "warning" : ""}`}>
            {account.suspended ? "Suspended" : "Active"}
          </span>
        </div>
      </div>
      {!current && (
        <details className="details account-edit">
          <summary>Edit account</summary>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void submit("staffEdit", {
                id: account.id,
                name: data.get("name"),
                email: data.get("email"),
                role: data.get("role"),
                suspended: data.has("suspended"),
              });
            }}
          >
            <fieldset className="form-fields" disabled={busy || refreshing}>
              <div className="grid2">
                <label htmlFor={`${uid}-name`}>
                  Display name
                  <input
                    id={`${uid}-name`}
                    name="name"
                    defaultValue={account.name}
                    maxLength={100}
                    required
                  />
                </label>
                <label htmlFor={`${uid}-email`}>
                  Email
                  <input
                    id={`${uid}-email`}
                    name="email"
                    type="email"
                    defaultValue={account.email}
                    maxLength={254}
                    required
                  />
                </label>
              </div>
              <label htmlFor={`${uid}-role`}>
                Role
                <select
                  id={`${uid}-role`}
                  name="role"
                  defaultValue={account.role}
                >
                  <option value="MODERATOR">Moderator</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
              <label className="choice-row">
                <input
                  name="suspended"
                  type="checkbox"
                  defaultChecked={account.suspended}
                />
                Suspended
              </label>
              <p className="muted text-xs mb-0">
                Saving signs out this staff member. The change goes straight to
                activity history.
              </p>
              <div className="account-actions">
                <button className="button" type="submit">
                  {busy ? "Saving…" : refreshing ? "Updating…" : "Save account"}
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={() => dialog.current?.showModal()}
                >
                  <Trash2 size={16} aria-hidden="true" /> Delete account
                </button>
              </div>
            </fieldset>
          </form>
        </details>
      )}
      {feedback && (
        <p
          className={`feedback ${feedback.error ? "error" : ""}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}
      <dialog
        ref={dialog}
        className="account-dialog"
        aria-labelledby={`${uid}-delete-heading`}
      >
        <h3 id={`${uid}-delete-heading`}>Delete {account.name}?</h3>
        <p className="muted text-sm">
          They will lose staff access immediately. Past activity and tournament
          records are retained. This account cannot be restored.
        </p>
        {feedback?.error && (
          <p className="feedback error" role="alert">
            {feedback.text}
          </p>
        )}
        <div className="account-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            Cancel
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => void submit("staffRemove", { id: account.id })}
          >
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </dialog>
    </article>
  );
}
