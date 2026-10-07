import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Link, type LinkProps } from "react-router-dom";
import { X } from "lucide-react";
import { cx } from "../domain/format";

type Variant = "primary" | "ink" | "lime" | "ghost" | "danger" | "quiet";

const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  ink: "btn-ink",
  lime: "btn-lime",
  ghost: "btn-ghost",
  danger: "btn-danger",
  quiet: "btn-quiet",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "lg";
  block?: boolean;
  unavailable?: boolean;
};

export function Button({ variant = "primary", size = "md", block, unavailable, className, children, onClick, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", variantClass[variant], size === "lg" && "btn-lg", block && "btn-block", className)}
      aria-disabled={unavailable || props.disabled || undefined}
      onClick={(event) => {
        if (unavailable || props.disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

type ButtonLinkProps = LinkProps & { variant?: Variant; size?: "md" | "lg"; block?: boolean };

export function ButtonLink({ variant = "primary", size = "md", block, className, ...props }: ButtonLinkProps) {
  return <Link className={cx("btn", variantClass[variant], size === "lg" && "btn-lg", block && "btn-block", className)} {...props} />;
}

export function TextField({
  label,
  hint,
  error,
  id,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-bold">{label}</label>
      <input id={fieldId} className="control" aria-invalid={error ? true : undefined} aria-describedby={cx(hintId, errorId) || undefined} {...props} />
      {hint && !error ? <p id={hintId} className="text-sm text-muted">{hint}</p> : null}
      {error ? <p id={errorId} className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  error,
  id,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const fieldId = id ?? generated;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-bold">{label}</label>
      <textarea id={fieldId} className="control" aria-invalid={error ? true : undefined} aria-describedby={cx(hintId, errorId) || undefined} {...props} />
      {hint && !error ? <p id={hintId} className="text-sm text-muted">{hint}</p> : null}
      {error ? <p id={errorId} className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
  locked = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
  locked?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((node) => node.tabIndex !== -1);
    panel?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [locked, open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onMouseDown={() => { if (!locked) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx(
          "flex max-h-[100dvh] w-full flex-col overflow-hidden bg-canvas outline-none sm:max-h-[min(820px,calc(100dvh-48px))] sm:rounded-[20px] sm:border-[1.5px] sm:border-ink sm:shadow-offset",
          size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl",
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-extrabold tracking-tight">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-ink hover:bg-paper" aria-label="Close dialog" onClick={() => { if (!locked) onClose(); }}>
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer ? <div className="border-t border-line bg-canvas px-4 py-3 sm:px-5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Banner({
  tone,
  title,
  children,
  onClose,
}: {
  tone: "info" | "attention" | "danger" | "ok";
  title: string;
  children?: ReactNode;
  onClose?: () => void;
}) {
  const styles = {
    info: "border-blue/30 bg-blue-wash text-blue-ink",
    attention: "border-amber/50 bg-amber-wash text-amber-ink",
    danger: "border-coral/40 bg-coral-wash text-coral-ink",
    ok: "border-ink/15 bg-lime text-anchor",
  }[tone];
  return (
    <div className={cx("flex items-start justify-between gap-3 rounded-2xl border px-4 py-3", styles)} role="status">
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        {children ? <div className="mt-1 text-sm">{children}</div> : null}
      </div>
      {onClose ? (
        <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" aria-label="Dismiss" onClick={onClose}>
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("motion-safe:animate-pulse rounded-2xl bg-line/80", className)} />;
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ProofPay`;
  }, [title]);
}

export function PageIntro({ title, lede, actions }: { title: string; lede?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {lede ? <p className="mt-1 max-w-2xl text-[15px] text-muted">{lede}</p> : null}
      </div>
      {actions}
    </div>
  );
}
