"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
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
const DialogNavigationContext = createContext<{
  register: (id: string, open: (fieldTarget?: string) => void) => () => void;
  open: (id: string, fieldTarget?: string) => void;
} | null>(null);

export function TaskDialogNavigation({
  children,
  onOpen,
}: {
  children: ReactNode;
  onOpen: (id: string) => void;
}) {
  const openers = useRef(new Map<string, (fieldTarget?: string) => void>());
  const navigation = useMemo(
    () => ({
      register(id: string, open: (fieldTarget?: string) => void) {
        openers.current.set(id, open);
        return () => {
          if (openers.current.get(id) === open) openers.current.delete(id);
        };
      },
      open(id: string, fieldTarget?: string) {
        const launch = openers.current.get(id);
        if (launch) {
          onOpen(id);
          launch(fieldTarget);
        }
      },
    }),
    [onOpen],
  );
  return (
    <DialogNavigationContext.Provider value={navigation}>
      {children}
    </DialogNavigationContext.Provider>
  );
}

export function TaskDialogButton({
  target,
  fieldTarget,
  children,
  className = "",
}: {
  target: string;
  fieldTarget?: string;
  children: ReactNode;
  className?: string;
}) {
  const navigation = useContext(DialogNavigationContext);
  return (
    <button
      type="button"
      className={`text-link readiness-action ${className}`.trim()}
      aria-haspopup="dialog"
      onClick={() => navigation?.open(target, fieldTarget)}
    >
      {children}
    </button>
  );
}

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
  closeLabel = "Close",
  fieldTarget,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  dirty?: boolean;
  closeLabel?: string;
  fieldTarget?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
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
    if (!fieldTarget) return;
    let highlighted: HTMLElement | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Wait until the dialog is open and its scrollable body has been laid out.
    const frame = requestAnimationFrame(() => {
      const target = dialog.current?.querySelector<HTMLElement>(fieldTarget);
      if (!target) return;
      highlighted =
        target.closest<HTMLElement>(".rule-choice") ??
        target.closest<HTMLElement>(".guided-field, label, th") ??
        target;
      const control = target.matches('input[type="hidden"]')
        ? highlighted.querySelector<HTMLElement>(
            'button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)',
          )
        : target;
      control?.focus({ preventScroll: true });
      const scroller = body.current!;
      const bounds = (control ?? highlighted).getBoundingClientRect();
      scroller.scrollTo({
        top:
          scroller.scrollTop +
          bounds.top -
          scroller.getBoundingClientRect().top -
          (scroller.clientHeight - bounds.height) / 2,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      highlighted.classList.add(styles.highlight);
      timeout = setTimeout(
        () => highlighted?.classList.remove(styles.highlight),
        3000,
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      highlighted?.classList.remove(styles.highlight);
    };
  }, [fieldTarget]);
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
          aria-label={closeLabel === "Close" ? "Close dialog" : closeLabel}
          onClick={dismiss}
          disabled={busy}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div ref={body} className={styles.body}>
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
              {closeLabel}
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
  triggerClassName = "button secondary small",
}: {
  label: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [fieldTarget, setFieldTarget] = useState<string>();
  const navigation = useContext(DialogNavigationContext);
  useEffect(() => {
    if (id && navigation)
      return navigation.register(id, (target) => {
        if (!disabled) {
          setFieldTarget(target);
          setOpen(true);
        }
      });
  }, [id, disabled, navigation]);
  return (
    <div className={styles.trigger} id={id}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          setFieldTarget(undefined);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <WorkspaceDialog
          title={title}
          description={description}
          fieldTarget={fieldTarget}
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
