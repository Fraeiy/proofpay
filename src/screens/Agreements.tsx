import { useMemo, useState } from "react";
import { AgreementCard, AgreementRow } from "../components/AgreementItem";
import { EmptyState } from "../components/EmptyState";
import { ButtonLink, PageIntro, Skeleton, usePageTitle } from "../components/ui";
import { cx, todayISO } from "../domain/format";
import { actionQueue, agreementSearchText, currentMilestone, matchesAgreementFilter, viewSlice, type AgreementFilter } from "../domain/selectors";
import { useDemo } from "../demo/store";

const filters: Array<{ id: AgreementFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs_you", label: "Needs you" },
  { id: "drafts", label: "Drafts" },
  { id: "acceptance", label: "Awaiting acceptance" },
  { id: "active", label: "Active" },
  { id: "review", label: "In review" },
  { id: "revision", label: "Revisions" },
  { id: "unfunded", label: "Not funded" },
  { id: "settled", label: "Settled" },
];

export function Agreements() {
  const demo = useDemo();
  usePageTitle("Agreements");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AgreementFilter>("all");
  const today = todayISO();
  const role = demo.state.role;
  const visible = viewSlice(demo.state.agreements, demo.state.ledger, role, demo.profile?.wallets?.length ? demo.profile.wallets : demo.sessionWallet).agreements;
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visible.filter((agreement) => {
      if (!matchesAgreementFilter(agreement, filter, role, today)) return false;
      if (!needle) return true;
      return agreementSearchText(agreement).includes(needle);
    });
  }, [filter, query, role, today, visible]);

  return (
    <div className="mx-auto min-w-0 max-w-[1120px] px-4 py-6 lg:px-6">
      <PageIntro
        title="Agreements"
        lede={demo.mode === "live" ? "Agreements for this wallet. Drafts stay private until you share them with the client wallet." : "Search by person, title, or milestone. Sample drafts stay with the freelancer view until they are shared."}
      />
      <div className="mb-4 grid gap-3">
        <label className="grid gap-1.5">
          <span className="text-sm font-bold">Search</span>
          <input className="control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Northline, video, welcome guide" />
        </label>
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Filter agreements">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              className={cx("min-h-11 rounded-full border px-3 text-sm font-bold", filter === item.id ? "border-ink bg-ink text-canvas" : "border-line bg-paper")}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {demo.previewLoading ? (
        <div aria-busy="true"><Skeleton className="h-40" /><p className="sr-only">Loading agreements.</p></div>
      ) : items.length === 0 ? (
        <EmptyState
          title={visible.length === 0 ? "No agreements yet" : "Nothing matches"}
          body={filter === "drafts" ? "Drafts appear here after you save one. Clients do not see a draft until it is shared." : "Try another filter, or clear the search."}
          action={filter === "all" && !query ? <ButtonLink to="/agreements/new">New agreement</ButtonLink> : <button type="button" className="btn btn-ghost" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>}
        />
      ) : (
        <>
          <div className="panel hidden divide-y divide-line lg:block">
            {items.map((agreement) => {
              const milestone = currentMilestone(agreement);
              const action = actionQueue([agreement], role, today)[0]?.actionLabel ?? "View";
              return <AgreementRow key={agreement.id} agreement={agreement} milestone={milestone} role={role} today={today} action={action} />;
            })}
          </div>
          <div className="grid min-w-0 gap-3 md:grid-cols-2 lg:hidden">
            {items.map((agreement) => {
              const milestone = currentMilestone(agreement);
              const action = actionQueue([agreement], role, today)[0]?.actionLabel ?? "View";
              return <AgreementCard key={agreement.id} agreement={agreement} milestone={milestone} role={role} today={today} action={action} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}
