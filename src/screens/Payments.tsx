import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { PageIntro, Skeleton, usePageTitle } from "../components/ui";
import { cx, formatDateTime, formatMoney, TOKEN } from "../domain/format";
import { ledgerLabel, matchesLedgerFilter, viewSlice, type LedgerFilter } from "../domain/selectors";
import { useDemo } from "../demo/store";

const filters: Array<{ id: LedgerFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "released", label: "Paid" },
  { id: "held", label: "Funded" },
  { id: "refunded", label: "Refunded" },
  { id: "incomplete", label: "Did not complete" },
];

export function Payments() {
  const demo = useDemo();
  usePageTitle("Payments");
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ledger = viewSlice(demo.state.agreements, demo.state.ledger, demo.state.role, demo.profile?.wallets?.length ? demo.profile.wallets : demo.sessionWallet).ledger;
    return ledger.filter((entry) => {
      if (!matchesLedgerFilter(entry, filter)) return false;
      if (!needle) return true;
      const agreement = demo.state.agreements.find((item) => item.id === entry.agreementId);
      return [agreement?.title, entry.detail, entry.toName, entry.fromName, entry.reference].join(" ").toLowerCase().includes(needle);
    });
  }, [demo.sessionWallet, demo.state.agreements, demo.state.ledger, demo.state.role, filter, query]);

  return (
    <div className="mx-auto min-w-0 max-w-[1120px] px-4 py-6 lg:px-6">
      <PageIntro title="Payments" lede={demo.mode === "live" ? "Confirmed rows follow the escrow contract. A transaction hash is not a payment until it is confirmed." : "Every row is simulated. A reference here is not a Monad transaction hash."} />
      <div className="mb-4 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-bold">Search</span>
          <input className="control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Agreement, person, or reference" />
        </label>
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Filter payments">
          {filters.map((item) => (
            <button key={item.id} type="button" aria-pressed={filter === item.id} className={cx("min-h-11 rounded-full border px-3 text-sm font-bold", filter === item.id ? "border-ink bg-ink text-canvas" : "border-line bg-paper")} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {demo.previewLoading ? <Skeleton className="h-40" /> : rows.length === 0 ? (
        <EmptyState title={demo.mode === "live" && demo.state.ledger.length === 0 ? "No payments yet" : "No matching payments"} body={demo.mode === "live" ? "Funded, paid, and refunded milestones for this wallet show up here after they are confirmed." : "Fund or release a milestone in the sample, or clear the filter. Failed and rejected attempts show under “Did not complete”."} action={<button type="button" className="btn btn-ghost" onClick={() => { setFilter("all"); setQuery(""); }}>Show all</button>} />
      ) : (
        <ul className="panel divide-y divide-line overflow-hidden">
          {rows.map((entry) => {
            const agreement = demo.state.agreements.find((item) => item.id === entry.agreementId);
            const milestone = agreement?.milestones.find((item) => item.id === entry.milestoneId);
            return (
              <li key={entry.id}>
                <div className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_auto] sm:items-center">
                  <Link to={`/payments/${entry.id}`} className="grid min-w-0 gap-1 no-underline hover:bg-canvas sm:col-span-1">
                    <span className="block font-extrabold">{ledgerLabel(entry, demo.state.role)} · {milestone?.title ?? "Milestone"}</span>
                    <span className="block text-sm text-muted">{agreement?.title} · {formatDateTime(entry.at)} · {entry.simulated ? "Simulated" : entry.result === "confirmed" ? "Confirmed" : "Attempt"}</span>
                    <span className="font-extrabold tabular-nums sm:hidden">{formatMoney(entry.amount)} {TOKEN}</span>
                  </Link>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <span className="hidden font-extrabold tabular-nums sm:inline">{formatMoney(entry.amount)} {TOKEN}</span>
                    {entry.result === "confirmed" ? (
                      <button type="button" className="btn btn-ghost" onClick={() => void demo.downloadReceipt(entry.id)}>Download receipt</button>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
