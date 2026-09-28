import { formatMoney, NETWORK_LABEL, TOKEN } from "../domain/format";
import { Button } from "./ui";

export function PaymentConfirm({
  mode,
  amount,
  agreement,
  milestone,
  counterparty,
  wallet,
  pending,
  live = false,
  onConfirm,
}: {
  mode: "fund" | "release" | "refund";
  amount: number;
  agreement: string;
  milestone: string;
  counterparty: string;
  wallet: string;
  pending: boolean;
  live?: boolean;
  onConfirm: () => void;
}) {
  const headline = live
    ? mode === "fund" ? "Deposit into escrow" : mode === "release" ? "Release payment" : "Refund the deposit"
    : mode === "fund" ? "Simulate funding" : mode === "release" ? "Simulate payment" : "Simulate refund";
  const body = live
    ? mode === "fund"
      ? `This deposits ${formatMoney(amount)} ${TOKEN} for “${milestone}”. You may be asked to allow that exact amount first. The deposit stays in escrow until you approve the work, or until both people agree to refund it. A missed deadline leaves the funds where they are. If you disagree, they can stay locked.`
      : mode === "release"
        ? `This pays ${formatMoney(amount)} ${TOKEN} to ${counterparty} for “${milestone}”. Confirmation releases the full milestone once. It cannot be paid again.`
        : `This refunds ${formatMoney(amount)} ${TOKEN} to ${counterparty} for “${milestone}”. Both people have agreed to this cancellation. The full amount goes back to the client.`
    : mode === "fund"
      ? `This holds ${formatMoney(amount)} ${TOKEN} for “${milestone}”. The client cannot withdraw it alone. It is released only if you approve the work, or refunded if both people cancel.`
      : mode === "release"
        ? `This pays ${formatMoney(amount)} ${TOKEN} to ${counterparty} for “${milestone}”. Confirmation releases the full milestone once. It cannot be paid again.`
        : `This refunds ${formatMoney(amount)} ${TOKEN} to ${counterparty} for “${milestone}”. Both people have agreed to this cancellation. The full amount goes back to the client.`;
  const action = live
    ? mode === "fund" ? "Confirm deposit" : mode === "release" ? "Approve and pay" : "Confirm refund"
    : mode === "fund" ? "Confirm simulated funding" : mode === "release" ? "Confirm simulated payment" : "Confirm simulated refund";
  return (
    <div className="grid gap-4">
      <p className="demo-pill w-fit">{live ? "Testnet · no monetary value" : "Simulated"}</p>
      <div>
        <p className="text-sm font-bold text-muted">{headline}</p>
        <p className="mt-1 text-[40px] font-extrabold leading-none tabular-nums tracking-tight">{formatMoney(amount)}</p>
        <p className="mt-1 font-bold">{TOKEN}</p>
      </div>
      <dl className="grid gap-3 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted">Agreement</dt><dd className="text-right font-bold">{agreement}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Milestone</dt><dd className="text-right font-bold">{milestone}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">{mode === "release" ? "Recipient" : mode === "refund" ? "Refund to" : "Held for"}</dt><dd className="max-w-[60%] text-right font-bold">{counterparty}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Wallet</dt><dd className="break-all text-right font-bold tabular-nums">{wallet}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Network</dt><dd className="text-right font-bold">{live ? "Monad testnet" : NETWORK_LABEL}</dd></div>
      </dl>
      <p className="text-sm leading-6">{body}</p>
      <Button block size="lg" onClick={onConfirm} unavailable={pending}>
        {pending ? "Waiting…" : action}
      </Button>
    </div>
  );
}
