import { Link } from "react-router-dom";
import { ActionQueue } from "../components/ActionQueue";
import { TestFunds } from "../components/TestFunds";
import { AgreementCard, AgreementRow } from "../components/AgreementItem";
import { FinancialSummary } from "../components/FinancialSummary";
import { EmptyState } from "../components/EmptyState";
import { ButtonLink, PageIntro, Skeleton, usePageTitle } from "../components/ui";
import { formatDateTime, formatMoney, todayISO, TOKEN } from "../domain/format";
import { actionQueue, currentMilestone, ledgerLabel, summarize, viewSlice } from "../domain/selectors";
import { useDemo } from "../demo/store";

export function Overview() {
  const demo = useDemo();
  const role = demo.state.role;
  usePageTitle("Overview");
  const today = todayISO();
  const slice = viewSlice(demo.state.agreements, demo.state.ledger, role, demo.profile?.wallets?.length ? demo.profile.wallets : demo.sessionWallet);
  const agreements = slice.agreements;
  const queue = actionQueue(agreements, role, today);
  const totals = summarize(agreements);
  const recent = slice.ledger.slice(0, 5);

  if (demo.previewLoading) {
    return (
      <div className="mx-auto grid max-w-[1120px] gap-4 px-4 py-6 lg:px-6" aria-busy="true" aria-live="polite">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
        <p className="sr-only">Loading overview.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-[1120px] px-4 py-6 lg:px-6">
      {demo.mode === "live" ? <TestFunds /> : null}
      <PageIntro
        title="What needs you"
        lede={role === "freelancer"
          ? "Funded work, reviews, and the weeks a client has not funded yet."
          : "Work to review, milestones still to fund, and what is already paid."}
      />
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="order-1 min-w-0 lg:col-start-2 lg:row-start-1">
          <FinancialSummary held={totals.held} awaiting={totals.awaiting} paid={totals.paid} refunded={totals.refunded} role={role} footnote={demo.mode === "live" ? "Testnet tUSDC has no monetary value. A missed deadline does not move these amounts. If someone disappears, funded money can stay locked until you both agree to cancel." : undefined} />
        </section>
        <section className="order-2 min-w-0 lg:col-start-1 lg:row-start-1">
          <ActionQueue items={queue.slice(0, 6)} />
        </section>
        <section className="order-3 min-w-0 lg:col-start-1 lg:row-start-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-extrabold">Active agreements</h2>
            <Link to="/agreements" className="text-sm font-bold text-blue-ink">View all</Link>
          </div>
          {agreements.length === 0 ? (
            <EmptyState title="No agreements in this view" body={demo.mode === "live" ? "Agreements you create show under My freelance work. Agreements where you are the client show under My hires." : "Create one as the freelancer, or switch perspective to see a client’s work."} action={<ButtonLink to="/agreements/new">New agreement</ButtonLink>} />
          ) : (
            <>
              <div className="panel hidden min-w-0 divide-y divide-line lg:block">
                {agreements.map((agreement) => {
                  const milestone = currentMilestone(agreement);
                  const action = actionQueue([agreement], role, today)[0]?.actionLabel ?? "View";
                  return <AgreementRow key={agreement.id} agreement={agreement} milestone={milestone} role={role} today={today} action={action} />;
                })}
              </div>
              <div className="grid min-w-0 gap-3 md:grid-cols-2 lg:hidden">
                {agreements.map((agreement) => {
                  const milestone = currentMilestone(agreement);
                  const action = actionQueue([agreement], role, today)[0]?.actionLabel ?? "View";
                  return <AgreementCard key={agreement.id} agreement={agreement} milestone={milestone} role={role} today={today} action={action} />;
                })}
              </div>
            </>
          )}
        </section>
        <section className="panel order-4 min-w-0 overflow-hidden lg:col-start-2 lg:row-start-2">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-extrabold">Recent activity</h2>
          </div>
          {recent.length === 0 ? <p className="px-4 py-5 text-sm text-muted">{demo.mode === "live" ? "Payments and attempts will show up here." : "No simulated payments yet."}</p> : (
            <ul>
              {recent.map((entry) => (
                <li key={entry.id} className="border-b border-line last:border-b-0">
                  <Link to={`/payments/${entry.id}`} className="block min-w-0 px-4 py-3 no-underline hover:bg-canvas">
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <span className="min-w-0 font-bold">{ledgerLabel(entry, role)}</span>
                      <span className="shrink-0 font-extrabold tabular-nums">{formatMoney(entry.amount)} {TOKEN}</span>
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">{formatDateTime(entry.at)} · {entry.simulated ? "Simulated" : entry.result === "confirmed" ? "Confirmed" : "Attempt"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
