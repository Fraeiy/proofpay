import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { MilestoneItem } from "../components/MilestoneItem";
import { Money } from "../components/Money";
import { PaymentConfirm } from "../components/PaymentConfirm";
import { SubmissionPanel } from "../components/SubmissionPanel";
import { AgreementBadge, HeldBadge, OverdueBadge, PhaseBadge } from "../components/StatusBadge";
import { Button, Dialog, TextArea, TextField, usePageTitle } from "../components/ui";
import { EmptyState } from "../components/EmptyState";
import { createId, formatDate, formatMoney, fundsAreHeld, isEvidenceUrl, isOverdue, shortWallet, todayISO, TOKEN } from "../domain/format";
import { PAYMENT_RULES } from "../domain/terms";
import { confirmedEntry, currentMilestone, detailActions, summarize, type DetailAction } from "../domain/selectors";
import type { EvidenceLink } from "../domain/types";
import { useDemo } from "../demo/store";

type LinkDraft = { id: string; label: string; url: string };

type Sheet =
  | { type: "submit"; step: 1 | 2 | 3; note: string; links: LinkDraft[]; error?: string }
  | { type: "review" }
  | { type: "changes"; reason: string; error?: string }
  | { type: "fund" }
  | { type: "pay" }
  | { type: "cancel"; note: string; mode: "propose" | "update"; error?: string }
  | { type: "respond" };

export function AgreementDetail() {
  const { agreementId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const demo = useDemo();
  const navigate = useNavigate();
  const today = todayISO();
  const agreement = demo.state.agreements.find((item) => item.id === agreementId);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [discard, setDiscard] = useState(false);
  usePageTitle(agreement?.title ?? "Agreement");

  if (!agreement || (agreement.status === "draft" && (demo.mode === "live" ? demo.actingRole(agreement) === "client" : demo.state.role === "client"))) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <EmptyState
          title={agreement ? "This draft has not been shared" : demo.mode === "live" ? "This agreement is private" : "Agreement not found"}
          body={agreement ? "The freelancer is still writing the terms. Clients see an agreement after it is shared." : demo.mode === "live" ? "Sign in with the client or freelancer wallet named when it was created. A link alone does not open the brief." : "It may have been reset from this browser."}
          action={<Button onClick={() => navigate("/agreements")}>Back to agreements</Button>}
        />
      </div>
    );
  }

  if (agreement.status === "draft") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <EmptyState title="This is still a draft" body="Finish the terms and share them before anyone can fund a milestone." action={<Button onClick={() => navigate(`/agreements/${agreement.id}/edit`)}>Continue draft</Button>} />
      </div>
    );
  }

  const requested = params.get("milestone");
  const selected = agreement.milestones.find((milestone) => milestone.id === requested) ?? currentMilestone(agreement);
  const role = demo.actingRole(agreement);
  const actions = detailActions(agreement, selected, role, demo.state.walletPreview, { impersonate: demo.impersonate });
  const totals = summarize([agreement]);
  const nextUnfunded = agreement.milestones.find((milestone) => milestone.phase === "unfunded");
  const overdue = selected ? isOverdue(selected.dueDate, selected.phase, today) : false;

  function selectMilestone(id: string) {
    const next = new URLSearchParams(params);
    next.set("milestone", id);
    setParams(next, { replace: true });
  }

  function openAction(action: DetailAction) {
    if (!action.enabled) return;
    if (action.id === "switch" && action.demoSwitch) {
      demo.setRole(action.demoSwitch);
      return;
    }
    if (action.id === "edit") {
      navigate(`/agreements/${agreementId}/edit`);
      return;
    }
    if (action.id === "accept") {
      void demo.acceptAgreement(agreementId, agreement?.termsRef ?? "").then((result) => {
        if (!result.ok) return;
      });
      return;
    }
    if (action.id === "receipt" && selected) {
      const kind = selected.phase === "refunded" ? "refund" : "release";
      const entry = confirmedEntry(demo.state.ledger, agreementId, selected.id, kind);
      if (entry) navigate(`/payments/${entry.id}`);
      return;
    }
    if (action.id === "fund") setSheet({ type: "fund" });
    if (action.id === "submit") setSheet({ type: "submit", step: 1, note: "", links: [{ id: createId("lnk"), label: "", url: "" }] });
    if (action.id === "review") setSheet({ type: "review" });
    if (action.id === "propose_cancel") setSheet({ type: "cancel", note: "", mode: "propose" });
    if (action.id === "update_cancel") setSheet({ type: "cancel", note: selected?.cancellation?.note ?? "", mode: "update" });
    if (action.id === "withdraw_cancel" && selected?.cancellation) {
      void demo.declineCancellation({ agreementId, milestoneId: selected.id, proposalId: selected.cancellation.id });
    }
    if (action.id === "respond_cancel") setSheet({ type: "respond" });
  }

  function dirtySheet() {
    if (!sheet) return false;
    if (sheet.type === "submit") return sheet.note.trim().length > 0 || sheet.links.some((link) => link.label.trim() || link.url.trim());
    if (sheet.type === "changes") return sheet.reason.trim().length > 0;
    if (sheet.type === "cancel") return sheet.mode === "propose" && sheet.note.trim().length > 0;
    return false;
  }

  function requestClose() {
    if (dirtySheet()) {
      setDiscard(true);
      return;
    }
    setSheet(null);
  }

  return (
    <div className="mx-auto grid max-w-[1120px] gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-6">
      <header className="order-1 lg:col-span-2">
        <Link to="/agreements" className="text-sm font-bold text-blue-ink">Agreements</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AgreementBadge status={agreement.status} />
          {selected && agreement.status === "active" ? <PhaseBadge phase={selected.phase} /> : null}
          {selected && fundsAreHeld(selected.phase) && selected.phase !== "funded" ? <HeldBadge /> : null}
          {overdue ? <OverdueBadge /> : null}
        </div>
        <h1 className="mt-2 text-[26px] font-extrabold tracking-tight sm:text-[32px]">{agreement.title}</h1>
        <p className="mt-1 text-sm text-muted">with {role === "freelancer" ? agreement.client.name : agreement.freelancer.name}</p>
        <p className="mt-3 max-w-3xl text-[15px]">{agreement.description}</p>
      </header>

      <aside className="contents lg:sticky lg:top-24 lg:col-start-2 lg:row-start-2 lg:block lg:self-start">
        <section className="panel order-2 p-4 lg:order-none">
          {selected ? (
            <>
              <p className="text-sm font-bold text-muted">This milestone</p>
              <div className="mt-1 flex items-start justify-between gap-3">
                <h2 className="font-extrabold">{selected.title}</h2>
                <Money cents={selected.amount} size="sm" />
              </div>
              <p className="mt-1 text-sm text-muted">{overdue ? `Due ${formatDate(selected.dueDate)} · overdue` : `Due ${formatDate(selected.dueDate)}`}</p>
            </>
          ) : null}
          {actions.primary ? (
            <div className="mt-4">
              <p id="primary-help" className="text-sm">{actions.primary.explanation}</p>
              <Button className="mt-3" block unavailable={!actions.primary.enabled} aria-describedby="primary-help" onClick={() => actions.primary && openAction(actions.primary)}>
                {actions.primary.label}
              </Button>
              {actions.primary.demoSwitch ? <p className="mt-2 text-xs text-muted">Demo perspective only. This switch is not permission to act as the other person.</p> : null}
            </div>
          ) : null}
          {actions.secondary.length > 0 ? (
            <div className="mt-3 grid gap-1">
              {actions.secondary.map((action) => (
                <Button key={action.id} variant="quiet" unavailable={!action.enabled} onClick={() => openAction(action)}>{action.label}</Button>
              ))}
            </div>
          ) : null}
        </section>
        <section className="panel order-4 p-4 lg:order-none">
          <h2 className="font-extrabold">This agreement</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <MoneyRow label="Funded and held" cents={totals.held} />
            <MoneyRow label="Paid" cents={totals.paid} />
            <MoneyRow label="Awaiting funding" cents={totals.awaiting} />
          </dl>
          {nextUnfunded ? (
            <p className="mt-3 rounded-2xl bg-canvas px-3 py-3 text-sm">
              <span className="font-extrabold">Next unfunded: {nextUnfunded.title}.</span> {formatMoney(nextUnfunded.amount)} {TOKEN} is not secured.
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted">No milestone is waiting for funding.</p>
          )}
          <div className="mt-4 grid gap-3 text-sm">
            <Party label="Freelancer" name={agreement.freelancer.name} wallet={agreement.freelancer.wallet} />
            <Party label="Client" name={agreement.client.name} wallet={agreement.client.wallet} />
          </div>
          <p className="mt-4 text-sm text-muted">Terms reference <span className="font-bold text-ink">{agreement.termsRef}</span>. {demo.mode === "live" ? "Funding stays closed until both wallets accept this exact version on the escrow contract." : "Sample reference only. It is not an onchain commitment."}</p>
          {agreement.clientAcceptedAt ? <p className="mt-2 text-sm">Accepted by both · {formatDate(agreement.clientAcceptedAt)}</p> : <p className="mt-2 text-sm">Shared by {agreement.freelancer.name}. Waiting for {agreement.client.name} to accept this version.</p>}
          <ul className="mt-4 grid gap-2 text-sm text-muted">
            {PAYMENT_RULES.slice(0, 4).map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </section>
      </aside>

      <div className="order-3 grid min-w-0 gap-4 lg:col-start-1 lg:row-start-2 lg:order-none">
        {overdue && selected ? (
          <div className="rounded-2xl border border-[var(--color-amber-line)] bg-amber-wash px-4 py-3 text-sm text-amber-ink">
            <p className="font-extrabold">Overdue · {formatDate(selected.dueDate)}</p>
            <p className="mt-1">A missed deadline does not pay or refund anyone. Funds stay where they are until the client approves the work, or both people agree to cancel.</p>
          </div>
        ) : null}
        <section className="grid gap-2" aria-label="Milestones">
          {agreement.milestones.map((milestone) => (
            <MilestoneItem key={milestone.id} milestone={milestone} selected={milestone.id === selected?.id} today={today} onSelect={() => selectMilestone(milestone.id)} />
          ))}
        </section>
        {selected ? (
          <section className="panel p-4">
            <h2 className="font-extrabold">What must be delivered</h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {selected.deliverables.map((item) => <li key={item.id} className="rounded-xl bg-canvas px-3 py-2">{item.text}</li>)}
            </ul>
          </section>
        ) : null}
        {selected ? <SubmissionPanel milestone={selected} /> : null}
        {agreement.status === "awaiting_acceptance" ? (
          <p className="text-sm text-muted">Funding stays closed until both people have accepted this version of the terms.</p>
        ) : null}
      </div>

      <Dialog
        open={sheet?.type === "submit"}
        title={selected?.phase === "changes_requested" ? "Submit revision" : "Submit work"}
        description={demo.mode === "live" ? "A note and links stay on this account. The contract stores only an opaque reference, not the links." : "Evidence is a note and links. Files are not part of this sample."}
        size="lg"
        onClose={requestClose}
        footer={sheet?.type === "submit" && !discard ? (
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => sheet.step === 1 ? requestClose() : setSheet({ ...sheet, step: (sheet.step - 1) as 1 | 2, error: undefined })}>Back</Button>
            <Button onClick={() => advanceSubmit(sheet, selected?.id ?? "")}>{sheet.step === 3 ? "Submit for review" : "Continue"}</Button>
          </div>
        ) : null}
      >
        {sheet?.type === "submit" && !discard ? (
          <div className="grid gap-4">
            <p className="text-sm font-bold">Step {sheet.step} of 3 · {sheet.step === 1 ? "Explanation" : sheet.step === 2 ? "Evidence links" : "Review"}</p>
            {sheet.error ? <p className="error-text" role="alert">{sheet.error}</p> : null}
            {sheet.step === 1 ? (
              <TextArea label="What did you deliver?" value={sheet.note} onChange={(event) => setSheet({ ...sheet, note: event.target.value, error: undefined })} hint="Earlier submissions stay on the milestone when you revise." />
            ) : null}
            {sheet.step === 2 ? (
              <div className="grid gap-3">
                {sheet.links.map((link, index) => (
                  <div key={link.id} className="grid gap-2 sm:grid-cols-2">
                    <TextField label={`Link label ${index + 1}`} value={link.label} onChange={(event) => updateLink(sheet, index, { label: event.target.value })} />
                    <TextField label="URL" value={link.url} inputMode="url" spellCheck={false} onChange={(event) => updateLink(sheet, index, { url: event.target.value })} />
                  </div>
                ))}
                <Button variant="ghost" unavailable={sheet.links.length >= 6} onClick={() => setSheet({ ...sheet, links: [...sheet.links, { id: createId("lnk"), label: "", url: "" }] })}>Add another link</Button>
                <p className="text-sm text-muted">ProofPay will not fetch or embed these URLs.</p>
              </div>
            ) : null}
            {sheet.step === 3 ? (
              <div className="grid gap-3 text-sm">
                <p className="whitespace-pre-wrap">{sheet.note}</p>
                <ul className="grid gap-1">{sheet.links.map((link) => <li key={link.id} className="font-bold">{link.label} · {link.url}</li>)}</ul>
                <p>Submitting does not release the {selected ? formatMoney(selected.amount) : ""} {TOKEN}. The client still has to approve it.</p>
              </div>
            ) : null}
          </div>
        ) : <DiscardPrompt onKeep={() => setDiscard(false)} onDiscard={() => { setDiscard(false); setSheet(null); }} />}
      </Dialog>

      <Dialog open={sheet?.type === "review" || sheet?.type === "changes" || sheet?.type === "pay"} title={sheet?.type === "pay" ? "Release payment" : sheet?.type === "changes" ? "Request changes" : "Review submission"} size="lg" onClose={requestClose} footer={!discard && sheet?.type === "review" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setSheet({ type: "changes", reason: "" })}>Request changes</Button>
          <Button onClick={() => setSheet({ type: "pay" })} unavailable={Boolean(demo.state.walletPreview !== "demo")}>Approve and pay</Button>
        </div>
      ) : !discard && sheet?.type === "changes" ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setSheet({ type: "review" })}>Back</Button>
          <Button onClick={sendChanges}>Send request</Button>
        </div>
      ) : null}>
        {discard ? <DiscardPrompt onKeep={() => setDiscard(false)} onDiscard={() => { setDiscard(false); setSheet(null); }} /> : null}
        {!discard && sheet?.type === "review" && selected ? <ReviewBody milestoneTitle={selected.title} deliverables={selected.deliverables.map((item) => item.text)} note={selected.submissions.at(-1)?.note ?? ""} links={selected.submissions.at(-1)?.links ?? []} /> : null}
        {!discard && sheet?.type === "changes" ? (
          <TextArea label="What needs to change?" value={sheet.reason} error={sheet.error} onChange={(event) => setSheet({ type: "changes", reason: event.target.value })} hint="The funds stay held. The freelancer can resubmit without losing the earlier note." />
        ) : null}
        {!discard && sheet?.type === "pay" && selected ? (
          <PaymentConfirm live={demo.mode === "live"} mode="release" amount={selected.amount} agreement={agreement.title} milestone={selected.title} counterparty={agreement.freelancer.name} wallet={agreement.freelancer.wallet} pending={demo.tx?.phase === "awaiting" || demo.tx?.phase === "submitted" || demo.tx?.phase === "pending"} onConfirm={() => { setSheet(null); void demo.runMoney({ kind: "release", agreementId, milestoneId: selected.id, title: `Pay ${selected.title}` }); }} />
        ) : null}
      </Dialog>

      <Dialog open={sheet?.type === "fund"} title="Fund milestone" onClose={() => setSheet(null)} >
        {selected && sheet?.type === "fund" ? (
          <PaymentConfirm live={demo.mode === "live"} mode="fund" amount={selected.amount} agreement={agreement.title} milestone={selected.title} counterparty={agreement.freelancer.name} wallet={agreement.freelancer.wallet} pending={demo.tx?.phase === "awaiting" || demo.tx?.phase === "submitted" || demo.tx?.phase === "pending"} onConfirm={() => { setSheet(null); void demo.runMoney({ kind: "fund", agreementId, milestoneId: selected.id, title: `Fund ${selected.title}` }); }} />
        ) : null}
      </Dialog>

      <Dialog open={sheet?.type === "cancel"} title={sheet?.type === "cancel" && sheet.mode === "update" ? "Update cancellation" : "Propose cancellation"} onClose={requestClose} footer={sheet?.type === "cancel" && !discard ? (
        <Button block onClick={() => sendCancel(sheet)}> {sheet.mode === "update" ? "Replace proposal" : "Propose cancellation"}</Button>
      ) : null}>
        {discard ? <DiscardPrompt onKeep={() => setDiscard(false)} onDiscard={() => { setDiscard(false); setSheet(null); }} /> : null}
        {!discard && sheet?.type === "cancel" && selected ? (
          <div className="grid gap-3">
            <p className="text-sm">This asks to refund {formatMoney(selected.amount)} {TOKEN} to {agreement.client.name}. Funds stay held until the other person agrees to this exact note. A proposal alone does not move money.</p>
            <TextArea label="Reason" value={sheet.note} error={sheet.error} onChange={(event) => setSheet({ ...sheet, note: event.target.value, error: undefined })} />
          </div>
        ) : null}
      </Dialog>

      <Dialog open={sheet?.type === "respond"} title="Review cancellation" onClose={() => setSheet(null)}>
        {sheet?.type === "respond" && selected?.cancellation ? (
          <div className="grid gap-4">
            <p className="whitespace-pre-wrap text-sm">{selected.cancellation.note}</p>
            <PaymentConfirm
              live={demo.mode === "live"}
              mode="refund"
              amount={selected.amount}
              agreement={agreement.title}
              milestone={selected.title}
              counterparty={agreement.client.name}
              wallet={agreement.client.wallet}
              pending={demo.tx?.phase === "awaiting" || demo.tx?.phase === "submitted" || demo.tx?.phase === "pending"}
              onConfirm={() => {
                const proposalId = selected.cancellation?.id ?? "";
                setSheet(null);
                void demo.runMoney({ kind: "refund", agreementId, milestoneId: selected.id, proposalId, title: `Refund ${selected.title}` });
              }}
            />
            <Button variant="ghost" onClick={() => { demo.declineCancellation({ agreementId, milestoneId: selected.id, proposalId: selected.cancellation?.id ?? "" }); setSheet(null); }}>Decline and keep the funds held</Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );

  function updateLink(current: Extract<Sheet, { type: "submit" }>, index: number, patch: Partial<LinkDraft>) {
    setSheet({ ...current, error: undefined, links: current.links.map((link, linkIndex) => (linkIndex === index ? { ...link, ...patch } : link)) });
  }

  async function advanceSubmit(current: Extract<Sheet, { type: "submit" }>, milestoneId: string) {
    if (current.step === 1) {
      if (current.note.trim().length < 10) {
        setSheet({ ...current, error: "Add at least a short explanation, 10 characters or more." });
        return;
      }
      setSheet({ ...current, step: 2, error: undefined });
      return;
    }
    if (current.step === 2) {
      const filled = current.links.filter((link) => link.label.trim() || link.url.trim());
      if (filled.length < 1 || filled.some((link) => !link.label.trim() || !isEvidenceUrl(link.url))) {
        setSheet({ ...current, error: "Each evidence link needs a label and an http(s) URL." });
        return;
      }
      setSheet({ ...current, step: 3, links: filled, error: undefined });
      return;
    }
    const result = await demo.submitWork({
      agreementId,
      milestoneId,
      note: current.note,
      links: current.links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })),
    });
    if (!result.ok) setSheet({ ...current, error: result.error });
    else setSheet(null);
  }

  async function sendChanges() {
    if (!selected || sheet?.type !== "changes") return;
    if (sheet.reason.trim().length < 10) {
      setSheet({ ...sheet, error: "Explain what needs to change, in at least 10 characters." });
      return;
    }
    const result = await demo.requestChanges({ agreementId, milestoneId: selected.id, reason: sheet.reason });
    if (!result.ok) setSheet({ ...sheet, error: result.error });
    else setSheet(null);
  }

  async function sendCancel(current: Extract<Sheet, { type: "cancel" }>) {
    if (!selected) return;
    if (current.note.trim().length < 10) {
      setSheet({ ...current, error: "Explain the cancellation in at least 10 characters." });
      return;
    }
    const result = current.mode === "update" && selected.cancellation
      ? await demo.replaceCancellation({ agreementId, milestoneId: selected.id, proposalId: selected.cancellation.id, note: current.note })
      : await demo.proposeCancellation({ agreementId, milestoneId: selected.id, note: current.note });
    if (!result.ok) setSheet({ ...current, error: result.error });
    else setSheet(null);
  }
}

function ReviewBody({ milestoneTitle, deliverables, note, links }: { milestoneTitle: string; deliverables: string[]; note: string; links: EvidenceLink[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl bg-paper p-4">
        <h3 className="font-extrabold">Agreed deliverables</h3>
        <p className="text-sm text-muted">{milestoneTitle}</p>
        <ul className="mt-3 grid gap-2 text-sm">{deliverables.map((item) => <li key={item} className="rounded-xl bg-canvas px-3 py-2">{item}</li>)}</ul>
      </section>
      <section className="rounded-2xl bg-paper p-4">
        <h3 className="font-extrabold">Submitted evidence</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm">{note}</p>
        <ul className="mt-3 grid gap-2 text-sm">
          {links.map((link) => (
            <li key={link.id}>
              <a className="font-bold text-blue-ink underline" href={link.url} target="_blank" rel="noreferrer noopener">{link.label}</a>
              <p className="text-muted">Not fetched or embedded.</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function DiscardPrompt({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div className="grid gap-3">
      <p className="font-extrabold">Discard this note?</p>
      <p className="text-sm">The text you entered will be lost. Submitted work already on the milestone stays.</p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={onDiscard}>Discard</Button>
        <Button variant="ghost" onClick={onKeep}>Keep editing</Button>
      </div>
    </div>
  );
}

function MoneyRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{label}</dt>
      <dd className="font-extrabold tabular-nums">{formatMoney(cents)} {TOKEN}</dd>
    </div>
  );
}

function Party({ label, name, wallet }: { label: string; name: string; wallet: string }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="font-bold">{name}</p>
      <p className="break-all tabular-nums" title={wallet}>{shortWallet(wallet)}</p>
    </div>
  );
}
