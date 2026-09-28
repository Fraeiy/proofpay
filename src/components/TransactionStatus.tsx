import { CircleAlert, CircleCheck, CircleX, Loader2, ShieldX } from "lucide-react";
import { cx } from "../domain/format";
import type { TxPhase } from "../demo/store";

export function TransactionStatus({
  phase,
  title,
  detail,
  live = false,
}: {
  phase: TxPhase;
  title: string;
  detail: string;
  live?: boolean;
}) {
  const icon = {
    awaiting: <Loader2 className="motion-safe:animate-spin" size={22} aria-hidden />,
    submitted: <Loader2 className="motion-safe:animate-spin" size={22} aria-hidden />,
    pending: <Loader2 className="motion-safe:animate-spin" size={22} aria-hidden />,
    success: <CircleCheck size={22} aria-hidden />,
    rejected: <ShieldX size={22} aria-hidden />,
    failed: <CircleX size={22} aria-hidden />,
    unknown: <CircleAlert size={22} aria-hidden />,
  }[phase];
  const tone = {
    awaiting: "bg-blue-wash text-blue-ink",
    submitted: "bg-blue-wash text-blue-ink",
    pending: "bg-blue-wash text-blue-ink",
    success: "bg-lime text-anchor",
    rejected: "bg-amber-wash text-amber-ink",
    failed: "bg-coral-wash text-coral-ink",
    unknown: "bg-amber-wash text-amber-ink",
  }[phase];
  const label = {
    awaiting: "Waiting for your wallet",
    submitted: "Submitted to the network",
    pending: "Pending confirmation",
    success: live ? "Confirmed" : "Recorded in the sample",
    rejected: "Rejected",
    failed: live ? "Reverted" : "Failed",
    unknown: "Unable to verify yet",
  }[phase];
  return (
    <div role="status" aria-live="polite" className="grid justify-items-center gap-3 py-4 text-center">
      <span className={cx("grid h-12 w-12 place-items-center rounded-2xl border border-ink/10", tone)}>{icon}</span>
      <p className="text-sm font-extrabold">{label}</p>
      <h3 className="text-xl font-extrabold tracking-tight">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{detail}</p>
    </div>
  );
}
