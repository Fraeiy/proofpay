import { formatDateTime, formatMoney, NETWORK_LABEL, TOKEN } from "../domain/format";
import { ledgerLabel } from "../domain/selectors";
import type { Agreement, LedgerEntry, Role } from "../domain/types";
import { Button } from "./ui";

export function ReceiptView({
  entry,
  agreement,
  milestoneTitle,
  role,
  onDownload,
}: {
  entry: LedgerEntry;
  agreement?: Agreement;
  milestoneTitle: string;
  role: Role;
  onDownload?: () => void;
}) {
  const settled = entry.result === "confirmed";
  const live = !entry.simulated;
  const heading = !settled
    ? live ? "Attempt" : "Simulated attempt"
    : entry.kind === "fund"
      ? live ? "Deposit confirmation" : "Simulated deposit"
      : entry.kind === "refund"
        ? live ? "Refund confirmation" : "Simulated refund"
        : live ? "Payment receipt" : "Simulated receipt";
  const blurb = live
    ? settled
      ? entry.kind === "release"
        ? "This payment is confirmed on the testnet escrow. The freelancer received this milestone."
        : entry.kind === "fund"
          ? "This deposit is confirmed in escrow. The freelancer has not been paid yet."
          : "This refund is confirmed. The full amount went back to the client."
      : "This attempt is not a confirmed chain event."
    : settled
      ? "This receipt is simulated. The reference below is not a transaction hash and there is no explorer link."
      : "This attempt did not move funds. It is not a chain receipt.";
  return (
    <article className="panel-ink overflow-hidden">
      <div className="px-5 py-5 sm:px-6">
        <p className="text-sm font-extrabold text-lime">{heading}</p>
        <p className="mt-3 text-[40px] font-extrabold leading-none tabular-nums tracking-tight sm:text-5xl">{formatMoney(entry.amount)}</p>
        <p className="mt-2 font-bold">{TOKEN} · {ledgerLabel(entry, role)}</p>
        <p className="mt-3 max-w-md text-sm text-on-anchor/75">{blurb}</p>
        {live ? <p className="mt-3 text-sm font-extrabold text-lime">TESTNET PAYMENT — NO REAL MONETARY VALUE.</p> : null}
        {settled && onDownload ? (
          <div className="mt-4">
            <Button variant="lime" onClick={onDownload}>Download receipt</Button>
          </div>
        ) : null}
      </div>
      <div className="border-t border-dashed border-white/20 bg-paper px-5 py-5 text-ink sm:px-6">
        <dl className="grid gap-4 text-sm">
          <Row label="Agreement" value={agreement?.title ?? "Agreement"} />
          <Row label="Milestone" value={milestoneTitle} />
          <Row label="From" value={`${entry.fromName} · ${entry.fromWallet}`} />
          <Row label="To" value={`${entry.toName} · ${entry.toWallet}`} />
          <Row label="Recorded" value={formatDateTime(entry.at)} />
          <Row label="Network" value={live ? "Monad testnet" : NETWORK_LABEL} />
          <Row label={live ? "Reference" : "Simulated reference"} value={entry.reference} />
          {entry.txHash ? <Row label="Transaction" value={entry.txHash} /> : null}
          {entry.explorerUrl ? (
            <div className="grid gap-1 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
              <dt className="font-bold text-muted">Explorer</dt>
              <dd className="break-all font-semibold">
                <a href={entry.explorerUrl} target="_blank" rel="noreferrer noopener" className="text-blue-ink">{entry.explorerUrl}</a>
              </dd>
            </div>
          ) : null}
          <Row label="What happened" value={entry.detail} />
        </dl>
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
      <dt className="font-bold text-muted">{label}</dt>
      <dd className="break-words font-semibold">{value}</dd>
    </div>
  );
}
