"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import styles from "./workspace-dialog.module.css";

const DialogContext = createContext<{
  busy: Set<string>;
  dirty: Set<string>;
} | null>(null);
const DialogActionsContext = createContext<HTMLDivElement | null>(null);

export function DialogActions({ children }: { children: ReactNode }) {
  const target = useContext(DialogActionsContext);
  return target ? createPortal(children, target) : children;
}

// Each form owns its pending request and draft, including dialogs with several forms.
export function useDialogForm(busy: boolean) {
  const context = useContext(DialogContext);
  const id = useId();
  useEffect(() => {
    if (busy) context?.busy.add(id);
    else context?.busy.delete(id);
    return () => {
      context?.busy.delete(id);
    };
  }, [busy, context, id]);
  useEffect(
    () => () => {
      context?.dirty.delete(id);
    },
    [context, id],
  );
  return {
    onChange: () => {
      context?.dirty.add(id);
    },
    onClick: (event: MouseEvent<HTMLFormElement>) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button?.type === "button") context?.dirty.add(id);
    },
    onSaved: () => {
      context?.dirty.delete(id);
    },
  };
}

export function WorkspaceDialog({
  title,
  description,
  children,
  onClose,
  busy = false,
  dirty = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  dirty?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const [state] = useState(() => ({
    busy: new Set<string>(),
    dirty: new Set<string>(),
  }));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savingNotice, setSavingNotice] = useState(false);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    element.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.documentElement.style.overflow = overflow;
      const target = trigger?.isConnected
        ? trigger
        : document.querySelector<HTMLElement>("main");
      target?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (confirmDiscard) keepEditing.current?.focus({ preventScroll: true });
  }, [confirmDiscard]);
  function dismiss() {
    if (busy || state.busy.size) {
      setSavingNotice(true);
      return;
    }
    if (dirty || state.dirty.size) setConfirmDiscard(true);
    else onClose();
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) => element.getClientRects().length && element.tabIndex >= 0,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (confirmDiscard) {
          setConfirmDiscard(false);
          heading.current?.focus({ preventScroll: true });
        } else dismiss();
      }}
    >
      <header className={styles.header}>
        <div>
          <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>
            {title}
          </h2>
          {description && <p id={`${id}-description`}>{description}</p>}
        </div>
        <button
          type="button"
          className="button secondary"
          aria-label="Close dialog"
          onClick={dismiss}
          disabled={busy}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.body}>
        <DialogContext.Provider value={state}>
          <DialogActionsContext.Provider value={actions}>
            {children}
          </DialogActionsContext.Provider>
        </DialogContext.Provider>
      </div>
      <footer className={styles.footer}>
        <div
          ref={setActions}
          className={styles.actions}
          hidden={confirmDiscard}
        />
        {confirmDiscard ? (
          <>
            <p role="alert">Discard unsaved changes?</p>
            <button
              ref={keepEditing}
              type="button"
              className="button secondary small"
              onClick={() => {
                setConfirmDiscard(false);
                heading.current?.focus({ preventScroll: true });
              }}
            >
              Keep editing
            </button>
            <button
              type="button"
              className="button danger small"
              onClick={() => {
                if (busy || state.busy.size) {
                  setConfirmDiscard(false);
                  setSavingNotice(true);
                } else onClose();
              }}
            >
              Discard changes
            </button>
          </>
        ) : (
          <>
            {savingNotice && (
              <p role="status">Please wait for saving to finish, then close.</p>
            )}
            <button
              type="button"
              className="button secondary small"
              onClick={dismiss}
              disabled={busy}
            >
              Close
            </button>
          </>
        )}
      </footer>
    </dialog>
  );
}

// Server-rendered content can be passed as children without making its data access client-side.
export function TaskDialog({
  label,
  title,
  description,
  children,
  id,
  disabled,
  readOnly = false,
}: {
  label: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.trigger} id={id}>
      <button
        type="button"
        className="button secondary small"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <WorkspaceDialog
          title={title}
          description={description}
          onClose={() => setOpen(false)}
        >
          {readOnly ? (
            <fieldset disabled className="form-fields">
              {children}
            </fieldset>
          ) : (
            children
          )}
        </WorkspaceDialog>
      )}
    </div>
  );
}
