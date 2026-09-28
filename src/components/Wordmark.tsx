import { cx } from "../domain/format";

export function Mark({ className, title = "ProofPay" }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title ? <title>{title}</title> : null}
      <rect x="2" y="3" width="22" height="26" rx="6" fill="#191A35" />
      <path d="M16 3h8.5A5.5 5.5 0 0 1 30 8.5V14H18.5A2.5 2.5 0 0 1 16 11.5V3Z" fill="#D1F45A" />
      <path d="M8 18.5 12.2 23 20 13" stroke="#F6F3EA" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-extrabold tracking-tight", inverse ? "text-on-anchor" : "text-ink")}>
      <Mark className="h-8 w-8 shrink-0" title="" />
      <span className={compact ? "sr-only" : "text-[17px]"}>ProofPay</span>
    </span>
  );
}
