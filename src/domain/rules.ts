import { createId, nowIso, parseAmountToCents, simulatedReference } from "./format";
import { termsReference } from "./terms";
import { hasErrors, validateAgreementInput } from "./validate";
import type {
  Agreement,
  AgreementInput,
  ApplyResult,
  DemoState,
  HeldPhase,
  LedgerEntry,
  LedgerKind,
  LedgerResult,
  Milestone,
  MilestonePhase,
  Party,
  Role,
} from "./types";

/**
 * Cancellation rules this demo enforces. A later contract must own them,
 * including the races below. The interface does not invent a second set.
 *
 * - Either party may propose cancellation of one unpaid funded milestone.
 * - The proposal stores an id and the phase to restore if it is declined.
 * - A proposal alone does not move funds.
 * - The other party must approve that same id before the full amount is refunded.
 * - Replacing the note creates a new id. An approval of the old id does nothing.
 * - Paid and refunded milestones cannot be cancelled.
 * - Deadlines never pay or refund anyone.
 */

type Clock = { now?: string; id?: (prefix: string) => string };

function nowOf(clock?: Clock): string {
  return clock?.now ?? nowIso();
}

function nextId(clock: Clock | undefined, prefix: string): string {
  return clock?.id?.(prefix) ?? createId(prefix);
}

function fail(state: DemoState, error: string): ApplyResult {
  return { ok: false, error, state };
}

function findAgreement(state: DemoState, agreementId: string): Agreement | undefined {
  return state.agreements.find((agreement) => agreement.id === agreementId);
}

function findMilestone(agreement: Agreement, milestoneId: string): Milestone | undefined {
  return agreement.milestones.find((milestone) => milestone.id === milestoneId);
}

function cloneState(state: DemoState): DemoState {
  return structuredClone(state);
}

function heldPhase(phase: MilestonePhase): phase is HeldPhase {
  return phase === "funded" || phase === "submitted" || phase === "changes_requested";
}

function refreshStatus(agreement: Agreement): void {
  if (agreement.status === "draft" || agreement.status === "awaiting_acceptance") return;
  const phases = agreement.milestones.map((milestone) => milestone.phase);
  if (phases.length > 0 && phases.every((phase) => phase === "refunded")) agreement.status = "cancelled";
  else if (phases.length > 0 && phases.every((phase) => phase === "paid" || phase === "refunded")) {
    agreement.status = "completed";
  } else agreement.status = "active";
}

function ledgerBase(
  state: DemoState,
  agreement: Agreement,
  milestone: Milestone,
  kind: LedgerKind,
  result: LedgerResult,
  at: string,
  detail: string,
  entryId: string,
): LedgerEntry {
  const clientPays = kind !== "refund";
  const from: Party = clientPays ? agreement.client : agreement.freelancer;
  const to: Party = kind === "refund" ? agreement.client : agreement.freelancer;
  return {
    id: entryId,
    agreementId: agreement.id,
    milestoneId: milestone.id,
    kind,
    result,
    amount: milestone.amount,
    fromName: kind === "refund" ? "Held in agreement" : from.name,
    fromWallet: from.wallet,
    toName: kind === "fund" ? `Held for ${to.name}` : to.name,
    toWallet: to.wallet,
    at,
    reference: simulatedReference(entryId),
    simulated: true,
    detail,
  };
}

function milestoneFromInput(input: AgreementInput["milestones"][number]): Milestone {
  const amount = parseAmountToCents(input.amount);
  if (amount == null) throw new Error("Milestone amount failed validation.");
  const deliverables = input.deliverables.map((line) => line.trim()).filter(Boolean);
  return {
    id: input.id,
    title: input.title.trim(),
    deliverables: deliverables.map((text, index) => ({ id: `${input.id}_d${index + 1}`, text })),
    amount,
    dueDate: input.dueDate,
    phase: "unfunded",
    submissions: [],
    revisionRequests: [],
  };
}

export function upsertDraft(
  state: DemoState,
  existingId: string | null,
  form: AgreementInput,
  freelancer: Party,
  clock?: Clock,
): ApplyResult {
  const next = cloneState(state);
  const createdAt = nowOf(clock);
  if (!existingId) {
    const id = nextId(clock, "agr");
    next.agreements.unshift({
      id,
      title: form.title.trim() || "Untitled agreement",
      description: form.description.trim(),
      status: "draft",
      freelancer,
      client: {
        name: form.clientName.trim() || "Client",
        role: "client",
        wallet: form.clientWallet.trim(),
      },
      termsRef: "",
      createdAt,
      milestones: [],
      draft: structuredClone(form),
    });
    return { ok: true, state: next, id };
  }

  const agreement = findAgreement(next, existingId);
  if (!agreement) return fail(state, "Draft not found.");
  if (agreement.status !== "draft") return fail(state, "Accepted terms cannot be edited in place.");
  agreement.title = form.title.trim() || "Untitled agreement";
  agreement.description = form.description.trim();
  agreement.client = {
    name: form.clientName.trim() || "Client",
    role: "client",
    wallet: form.clientWallet.trim(),
  };
  agreement.draft = structuredClone(form);
  return { ok: true, state: next, id: agreement.id };
}

export function deleteDraft(state: DemoState, agreementId: string): ApplyResult {
  const agreement = findAgreement(state, agreementId);
  if (!agreement) return fail(state, "Draft not found.");
  if (agreement.status !== "draft") return fail(state, "Only an unshared draft can be deleted.");
  return {
    ok: true,
    state: { ...state, agreements: state.agreements.filter((item) => item.id !== agreementId) },
    id: agreementId,
  };
}

export function shareDraft(
  state: DemoState,
  agreementId: string,
  freelancerWallet: string,
  clock?: Clock,
): ApplyResult {
  const agreement = findAgreement(state, agreementId);
  if (!agreement?.draft) return fail(state, "There is no draft to share.");
  if (agreement.status !== "draft") return fail(state, "This agreement has already been shared.");
  const errors = validateAgreementInput(agreement.draft, freelancerWallet, (clock?.now ?? nowIso()).slice(0, 10));
  if (hasErrors(errors)) return { ok: false, error: "Fix the highlighted fields before sharing.", state, errors };

  const next = cloneState(state);
  const saved = findAgreement(next, agreementId);
  if (!saved?.draft) return fail(state, "There is no draft to share.");
  const form = saved.draft;
  const at = nowOf(clock);
  saved.title = form.title.trim();
  saved.description = form.description.trim();
  saved.client = { name: form.clientName.trim(), role: "client", wallet: form.clientWallet.trim() };
  saved.milestones = form.milestones.map((milestone) => milestoneFromInput(milestone));
  saved.termsRef = termsReference(form, freelancerWallet);
  saved.freelancerAcceptedAt = at;
  saved.sharedAt = at;
  saved.status = "awaiting_acceptance";
  saved.draft = null;
  return { ok: true, state: next, id: saved.id };
}

export function acceptAgreement(state: DemoState, agreementId: string, role: Role, termsRef: string, clock?: Clock): ApplyResult {
  const agreement = findAgreement(state, agreementId);
  if (!agreement) return fail(state, "Agreement not found.");
  if (role !== "client") return fail(state, "Only the client can accept these terms.");
  if (agreement.status !== "awaiting_acceptance") return fail(state, "This agreement is not waiting for acceptance.");
  if (!agreement.freelancerAcceptedAt || !agreement.termsRef) return fail(state, "The freelancer has not signed this version.");
  if (agreement.termsRef !== termsRef) return fail(state, "These terms changed. Accept the current version.");

  const next = cloneState(state);
  const saved = findAgreement(next, agreementId);
  if (!saved) return fail(state, "Agreement not found.");
  saved.clientAcceptedAt = nowOf(clock);
  saved.status = "active";
  return { ok: true, state: next, id: saved.id };
}

function moneyContext(state: DemoState, agreementId: string, milestoneId: string, role: Role, expected: Role) {
  const agreement = findAgreement(state, agreementId);
  if (!agreement) return fail(state, "Agreement not found.");
  const milestone = findMilestone(agreement, milestoneId);
  if (!milestone) return fail(state, "Milestone not found.");
  if (role !== expected) {
    return fail(state, expected === "client" ? "Only the client can move these funds." : "Only the freelancer can submit this work.");
  }
  if (agreement.status !== "active" && agreement.status !== "completed") {
    return fail(state, "Both people need to accept the same terms before money can move.");
  }
  return { agreement, milestone };
}

export function fundMilestone(state: DemoState, agreementId: string, milestoneId: string, role: Role, clock?: Clock): ApplyResult {
  const found = moneyContext(state, agreementId, milestoneId, role, "client");
  if ("ok" in found) return found;
  if (found.agreement.status !== "active") return fail(state, "Both people need to accept the same terms before funding.");
  if (found.milestone.phase !== "unfunded") return fail(state, "This milestone is already funded.");

  const next = cloneState(state);
  const saved = findAgreement(next, agreementId);
  const milestone = saved ? findMilestone(saved, milestoneId) : undefined;
  if (!saved || !milestone) return fail(state, "Milestone not found.");
  const at = nowOf(clock);
  milestone.phase = "funded";
  milestone.fundedAt = at;
  const entryId = nextId(clock, "led");
  next.ledger.unshift(
    ledgerBase(next, saved, milestone, "fund", "confirmed", at, `Funded “${milestone.title}”. The amount is held, not paid out.`, entryId),
  );
  return { ok: true, state: next, entryId };
}

export function submitWork(
  state: DemoState,
  input: { agreementId: string; milestoneId: string; role: Role; note: string; links: Array<{ label: string; url: string }> },
  clock?: Clock,
): ApplyResult {
  const found = moneyContext(state, input.agreementId, input.milestoneId, input.role, "freelancer");
  if ("ok" in found) return found;
  if (found.milestone.phase !== "funded" && found.milestone.phase !== "changes_requested") {
    return fail(state, "Work can be submitted when the milestone is funded, or after changes are requested.");
  }
  const note = input.note.trim();
  if (note.length < 10) return fail(state, "Add a short explanation of what you delivered.");
  if (input.links.length < 1) return fail(state, "Add at least one evidence link.");

  const next = cloneState(state);
  const saved = findAgreement(next, input.agreementId);
  const milestone = saved ? findMilestone(saved, input.milestoneId) : undefined;
  if (!saved || !milestone) return fail(state, "Milestone not found.");
  const at = nowOf(clock);
  const submissionId = nextId(clock, "sub");
  milestone.submissions.push({
    id: submissionId,
    note,
    submittedAt: at,
    links: input.links.map((link, index) => ({
      id: `${submissionId}_l${index + 1}`,
      label: link.label.trim(),
      url: link.url.trim(),
    })),
  });
  milestone.phase = "submitted";
  if (milestone.cancellation) delete milestone.cancellation;
  return { ok: true, state: next, id: submissionId };
}

export function requestChanges(
  state: DemoState,
  input: { agreementId: string; milestoneId: string; role: Role; reason: string },
  clock?: Clock,
): ApplyResult {
  const found = moneyContext(state, input.agreementId, input.milestoneId, input.role, "client");
  if ("ok" in found) return found;
  if (found.milestone.phase !== "submitted") return fail(state, "Changes can be requested after a submission, before payment.");
  const latest = found.milestone.submissions[found.milestone.submissions.length - 1];
  if (!latest) return fail(state, "There is no submission to send back.");
  const reason = input.reason.trim();
  if (reason.length < 10) return fail(state, "Explain what needs to change.");

  const next = cloneState(state);
  const saved = findAgreement(next, input.agreementId);
  const milestone = saved ? findMilestone(saved, input.milestoneId) : undefined;
  if (!milestone) return fail(state, "Milestone not found.");
  const current = milestone.submissions[milestone.submissions.length - 1];
  if (!current) return fail(state, "There is no submission to send back.");
  milestone.revisionRequests.push({
    id: nextId(clock, "rev"),
    submissionId: current.id,
    reason,
    requestedAt: nowOf(clock),
  });
  milestone.phase = "changes_requested";
  return { ok: true, state: next };
}

export function releasePayment(state: DemoState, agreementId: string, milestoneId: string, role: Role, clock?: Clock): ApplyResult {
  const found = moneyContext(state, agreementId, milestoneId, role, "client");
  if ("ok" in found) return found;
  if (found.milestone.phase === "paid") return fail(state, "This milestone is already paid.");
  if (found.milestone.phase !== "submitted") return fail(state, "Payment waits for a submission that is ready for review.");

  const next = cloneState(state);
  const saved = findAgreement(next, agreementId);
  const milestone = saved ? findMilestone(saved, milestoneId) : undefined;
  if (!saved || !milestone) return fail(state, "Milestone not found.");
  const at = nowOf(clock);
  milestone.phase = "paid";
  milestone.paidAt = at;
  if (milestone.cancellation) delete milestone.cancellation;
  refreshStatus(saved);
  const entryId = nextId(clock, "led");
  next.ledger.unshift(
    ledgerBase(
      next,
      saved,
      milestone,
      "release",
      "confirmed",
      at,
      `Released the full amount for “${milestone.title}”.`,
      entryId,
    ),
  );
  return { ok: true, state: next, entryId };
}

export function proposeCancellation(
  state: DemoState,
  input: { agreementId: string; milestoneId: string; role: Role; note: string },
  clock?: Clock,
): ApplyResult {
  const agreement = findAgreement(state, input.agreementId);
  if (!agreement) return fail(state, "Agreement not found.");
  const milestone = findMilestone(agreement, input.milestoneId);
  if (!milestone) return fail(state, "Milestone not found.");
  if (agreement.status !== "active") return fail(state, "Cancellation is available on an active agreement.");
  if (!heldPhase(milestone.phase)) return fail(state, "Only an unpaid funded milestone can be cancelled.");
  const note = input.note.trim();
  if (note.length < 10) return fail(state, "Explain why this milestone should be cancelled.");

  const next = cloneState(state);
  const saved = findAgreement(next, input.agreementId);
  const target = saved ? findMilestone(saved, input.milestoneId) : undefined;
  if (!saved || !target || !heldPhase(target.phase)) return fail(state, "Only an unpaid funded milestone can be cancelled.");
  target.cancellation = {
    id: nextId(clock, "can"),
    proposedBy: input.role,
    note,
    proposedAt: nowOf(clock),
    basePhase: target.phase,
  };
  target.phase = "cancellation_proposed";
  return { ok: true, state: next, id: target.cancellation.id };
}

export function replaceCancellation(
  state: DemoState,
  input: { agreementId: string; milestoneId: string; role: Role; proposalId: string; note: string },
  clock?: Clock,
): ApplyResult {
  const agreement = findAgreement(state, input.agreementId);
  const milestone = agreement ? findMilestone(agreement, input.milestoneId) : undefined;
  if (!agreement || !milestone?.cancellation) return fail(state, "There is no open cancellation proposal.");
  if (milestone.cancellation.proposedBy !== input.role) return fail(state, "Only the person who proposed this can update it.");
  if (milestone.cancellation.id !== input.proposalId) return fail(state, "This proposal changed. Review the current version.");
  const note = input.note.trim();
  if (note.length < 10) return fail(state, "Explain why this milestone should be cancelled.");

  const next = cloneState(state);
  const target = findMilestone(findAgreement(next, input.agreementId) as Agreement, input.milestoneId);
  if (!target?.cancellation) return fail(state, "There is no open cancellation proposal.");
  target.cancellation = {
    ...target.cancellation,
    id: nextId(clock, "can"),
    note,
    proposedAt: nowOf(clock),
  };
  return { ok: true, state: next, id: target.cancellation.id };
}

export function approveCancellation(
  state: DemoState,
  input: { agreementId: string; milestoneId: string; role: Role; proposalId: string },
  clock?: Clock,
): ApplyResult {
  const agreement = findAgreement(state, input.agreementId);
  const milestone = agreement ? findMilestone(agreement, input.milestoneId) : undefined;
  if (!agreement || !milestone?.cancellation) return fail(state, "There is no open cancellation proposal.");
  if (milestone.phase === "refunded" || milestone.phase === "paid") return fail(state, "This milestone is already settled.");
  if (milestone.cancellation.proposedBy === input.role) return fail(state, "The other person still needs to agree to this proposal.");
  if (milestone.cancellation.id !== input.proposalId) {
    return fail(state, "That approval is for an older proposal. It does not apply.");
  }

  const next = cloneState(state);
  const saved = findAgreement(next, input.agreementId);
  const target = saved ? findMilestone(saved, input.milestoneId) : undefined;
  if (!saved || !target?.cancellation || target.cancellation.id !== input.proposalId) {
    return fail(state, "That approval is for an older proposal. It does not apply.");
  }
  const at = nowOf(clock);
  target.phase = "refunded";
  target.refundedAt = at;
  delete target.cancellation;
  refreshStatus(saved);
  const entryId = nextId(clock, "led");
  next.ledger.unshift(
    ledgerBase(next, saved, target, "refund", "confirmed", at, `Refunded the full amount for “${target.title}” to the client.`, entryId),
  );
  return { ok: true, state: next, entryId };
}

export function declineCancellation(
  state: DemoState,
  input: { agreementId: string; milestoneId: string; role: Role; proposalId: string },
): ApplyResult {
  const agreement = findAgreement(state, input.agreementId);
  const milestone = agreement ? findMilestone(agreement, input.milestoneId) : undefined;
  if (!milestone?.cancellation) return fail(state, "There is no open cancellation proposal.");
  if (milestone.cancellation.id !== input.proposalId) return fail(state, "That response is for an older proposal.");
  const next = cloneState(state);
  const target = findMilestone(findAgreement(next, input.agreementId) as Agreement, input.milestoneId);
  if (!target?.cancellation || target.cancellation.id !== input.proposalId) {
    return fail(state, "That response is for an older proposal.");
  }
  target.phase = target.cancellation.basePhase;
  delete target.cancellation;
  return { ok: true, state: next };
}

export function recordAttempt(
  state: DemoState,
  input: {
    agreementId: string;
    milestoneId: string;
    kind: LedgerKind;
    result: Exclude<LedgerResult, "confirmed">;
  },
  clock?: Clock,
): ApplyResult {
  const agreement = findAgreement(state, input.agreementId);
  const milestone = agreement ? findMilestone(agreement, input.milestoneId) : undefined;
  if (!agreement || !milestone) return fail(state, "Milestone not found.");
  const next = cloneState(state);
  const saved = findAgreement(next, input.agreementId) as Agreement;
  const target = findMilestone(saved, input.milestoneId) as Milestone;
  const at = nowOf(clock);
  const entryId = nextId(clock, "led");
  const detail =
    input.result === "rejected"
      ? "The wallet preview rejected this transaction. No funds moved."
      : "The simulated transaction failed. Balances are unchanged.";
  next.ledger.unshift(ledgerBase(next, saved, target, input.kind, input.result, at, detail, entryId));
  return { ok: true, state: next, entryId };
}

export function resetDemo(seed: DemoState): DemoState {
  return structuredClone(seed);
}
