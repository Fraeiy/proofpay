import { formatMoney, TOKEN } from "../domain/format";
import type { Role } from "../domain/types";

export function FinancialSummary({
  held,
  awaiting,
  paid,
  refunded = 0,
  role,
  footnote,
}: {
  held: number;
  awaiting: number;
  paid: number;
  refunded?: number;
  role: Role;
  footnote?: string;
}) {
  const paidLabel = role === "freelancer" ? "Paid to you" : "Paid out";
  return (
    <section className="panel-ink p-4 sm:p-6" aria-label="Money summary">
      <p className="text-sm font-extrabold text-lime">Funded and held</p>
      <div className="mt-2 flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-[clamp(2rem,10vw,3.25rem)] font-extrabold leading-none tabular-nums tracking-tight text-lime">{formatMoney(held)}</p>
        <p className="pb-1 text-sm font-extrabold text-lime">{TOKEN}</p>
      </div>
      <p className="mt-2 text-sm text-on-anchor/80">
        {role === "freelancer" ? "Held for your work. This is not income yet." : "Held for open milestones. This has not been paid out."}
      </p>
      <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/15 pt-3">
        <span className="font-bold">{paidLabel}</span>
        <span className="font-extrabold tabular-nums">{formatMoney(paid)} <span className="text-xs font-bold">{TOKEN}</span></span>
      </div>
      <div className="mt-3 rounded-2xl bg-canvas p-3 text-ink sm:p-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="font-extrabold">Awaiting funding</span>
          <span className="font-extrabold tabular-nums">{formatMoney(awaiting)}</span>
        </div>
        <p className="mt-1 text-sm text-muted">Not secured. The client has not funded this yet, so it is not held.</p>
      </div>
      {refunded > 0 ? (
        <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="font-bold">Refunded</span>
          <span className="font-extrabold tabular-nums">{formatMoney(refunded)} <span className="text-xs font-bold">{TOKEN}</span></span>
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-on-anchor/70">{footnote ?? `Simulated ${TOKEN}. A missed deadline does not move these amounts.`}</p>
    </section>
  );
}
