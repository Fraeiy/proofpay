import { formatDate, fundsAreHeld, isOverdue } from "./format";
import type {
  Agreement,
  AgreementStatus,
  DemoState,
  LedgerEntry,
  LedgerKind,
  Milestone,
  MilestonePhase,
  Role,
  WalletPreview,
} from "./types";

export type QueueTone = "action" | "attention" | "waiting";

export type QueueItem = {
  id: string;
  href: string;
  title: string;
  detail: string;
  actionLabel: string;
  tone: QueueTone;
  sort: number;
  due: string;
};

export type DetailActionId =
  | "edit"
  | "accept"
  | "fund"
  | "submit"
  | "review"
  | "receipt"
  | "switch"
  | "propose_cancel"
  | "respond_cancel"
  | "withdraw_cancel"
  | "update_cancel";

export type DetailAction = {
  id: DetailActionId;
  label: string;
  enabled: boolean;
  explanation: string;
  demoSwitch?: Role;
};

export type AgreementFilter =
  | "all"
  | "needs_you"
  | "drafts"
  | "acceptance"
  | "active"
  | "review"
  | "revision"
  | "unfunded"
  | "settled";

export type LedgerFilter = "all" | "released" | "held" | "refunded" | "incomplete";

export function moneyBlockReason(preview: WalletPreview): string | null {
  if (preview === "disconnected") {
    return "No wallet is connected. Choose the demo session in Account to simulate funding and payment. This preview does not connect a wallet.";
  }
  if (preview === "wrong_network") {
    return "This preview is on the wrong network. The later testnet path uses Monad. Switch back to the demo session to continue. No funds moved.";
  }
  return null;
}

export function counterparty(agreement: Agreement, role: Role) {
  return role === "freelancer" ? agreement.client : agreement.freelancer;
}

export function visibleAgreements(agreements: Agreement[], role: Role): Agreement[] {
  if (role === "client") return agreements.filter((agreement) => agreement.status !== "draft");
  return agreements;
}

export function viewSlice(agreements: Agreement[], ledger: LedgerEntry[], role: Role, sessionWallet: string | readonly string[] | null) {
  const wallets = (Array.isArray(sessionWallet) ? sessionWallet : sessionWallet ? [sessionWallet] : []).map((wallet) => wallet.toLowerCase());
  const visible = wallets.length
    ? agreements.filter((agreement) => {
        if (role === "freelancer") return wallets.includes(agreement.freelancer.wallet.toLowerCase());
        return Boolean(agreement.client.wallet) && wallets.includes(agreement.client.wallet.toLowerCase()) && agreement.status !== "draft";
      })
    : visibleAgreements(agreements, role);
  const ids = new Set(visible.map((agreement) => agreement.id));
  return { agreements: visible, ledger: ledger.filter((entry) => ids.has(entry.agreementId)) };
}

export function summarize(agreements: Agreement[]) {
  const totals = { held: 0, awaiting: 0, paid: 0, refunded: 0 };
  for (const agreement of agreements) {
    if (agreement.status !== "active" && agreement.status !== "completed" && agreement.status !== "cancelled") continue;
    for (const milestone of agreement.milestones) {
      if (milestone.phase === "paid") totals.paid += milestone.amount;
      else if (milestone.phase === "refunded") totals.refunded += milestone.amount;
      else if (milestone.phase === "unfunded") totals.awaiting += milestone.amount;
      else totals.held += milestone.amount;
    }
  }
  return totals;
}

export function currentMilestone(agreement: Agreement): Milestone | undefined {
  return (
    agreement.milestones.find((milestone) => milestone.phase !== "paid" && milestone.phase !== "refunded") ??
    agreement.milestones[agreement.milestones.length - 1]
  );
}

export function milestoneHref(agreementId: string, milestoneId?: string): string {
  if (!milestoneId) return `/agreements/${agreementId}`;
  return `/agreements/${agreementId}?milestone=${encodeURIComponent(milestoneId)}`;
}

function pushQueue(
  items: QueueItem[],
  item: Omit<QueueItem, "due"> & { due?: string },
): void {
  items.push({ due: item.due ?? "9999-99-99", ...item });
}

export function actionQueue(agreements: Agreement[], role: Role, today: string): QueueItem[] {
  const items: QueueItem[] = [];
  for (const agreement of visibleAgreements(agreements, role)) {
    if (agreement.status === "draft") {
      pushQueue(items, {
        id: agreement.id,
        href: `/agreements/${agreement.id}/edit`,
        title: `Finish draft · ${agreement.title}`,
        detail: "Not shared. The client cannot see it yet.",
        actionLabel: "Continue",
        tone: "waiting",
        sort: 50,
      });
      continue;
    }
    if (agreement.status === "awaiting_acceptance") {
      if (role === "client") {
        pushQueue(items, {
          id: agreement.id,
          href: `/agreements/${agreement.id}`,
          title: `Accept · ${agreement.title}`,
          detail: `${agreement.freelancer.name} shared these terms`,
          actionLabel: "Review terms",
          tone: "action",
          sort: 1,
        });
      } else {
        pushQueue(items, {
          id: agreement.id,
          href: `/agreements/${agreement.id}`,
          title: `Waiting on ${agreement.client.name}`,
          detail: `${agreement.title} is not accepted yet`,
          actionLabel: "View",
          tone: "waiting",
          sort: 40,
        });
      }
      continue;
    }

    for (const milestone of agreement.milestones) {
      const href = milestoneHref(agreement.id, milestone.id);
      const overdue = isOverdue(milestone.dueDate, milestone.phase, today);
      const dueText = overdue ? `Overdue ${formatDate(milestone.dueDate)}` : `Due ${formatDate(milestone.dueDate)}`;
      const due = milestone.dueDate;
      if (milestone.phase === "changes_requested") {
        pushQueue(items, role === "freelancer"
          ? { id: milestone.id, href, title: `Revise · ${milestone.title}`, detail: `${agreement.client.name} asked for changes · ${dueText}`, actionLabel: "Revise", tone: "attention", sort: 0, due }
          : { id: milestone.id, href, title: `Waiting on a revision · ${milestone.title}`, detail: `${agreement.freelancer.name} · ${dueText}`, actionLabel: "View", tone: "waiting", sort: 40, due });
      } else if (milestone.phase === "submitted") {
        pushQueue(items, role === "client"
          ? { id: milestone.id, href, title: `Review · ${milestone.title}`, detail: `${agreement.title} · ${dueText}`, actionLabel: "Review", tone: "action", sort: 1, due }
          : { id: milestone.id, href, title: `In review · ${milestone.title}`, detail: `Waiting on ${agreement.client.name} · funds held`, actionLabel: "View", tone: "waiting", sort: 30, due });
      } else if (milestone.phase === "funded") {
        pushQueue(items, role === "freelancer"
          ? { id: milestone.id, href, title: `Submit · ${milestone.title}`, detail: `Funds are held · ${dueText}`, actionLabel: "Submit work", tone: "action", sort: 2, due }
          : { id: milestone.id, href, title: `Waiting on delivery · ${milestone.title}`, detail: `${agreement.freelancer.name} · ${dueText}`, actionLabel: "View", tone: "waiting", sort: 35, due });
      } else if (milestone.phase === "unfunded") {
        pushQueue(items, role === "client"
          ? { id: milestone.id, href, title: `Fund · ${milestone.title}`, detail: `${agreement.title} · ${dueText}`, actionLabel: "Fund", tone: "action", sort: 3, due }
          : { id: milestone.id, href, title: `Not funded · ${milestone.title}`, detail: `Waiting on ${agreement.client.name}. This amount is not secured.`, actionLabel: "View", tone: "waiting", sort: 45, due });
      } else if (milestone.phase === "cancellation_proposed" && milestone.cancellation) {
        const mine = milestone.cancellation.proposedBy === role;
        pushQueue(items, mine
          ? { id: milestone.id, href, title: `Cancellation pending · ${milestone.title}`, detail: "Waiting on the other person. Funds stay held.", actionLabel: "View", tone: "waiting", sort: 20, due }
          : { id: milestone.id, href, title: `Cancellation to review · ${milestone.title}`, detail: `${agreement.title} · funds still held`, actionLabel: "Respond", tone: "attention", sort: 0, due });
      }
    }
  }
  return items.sort((a, b) => a.sort - b.sort || a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

export function needsAttention(agreement: Agreement, role: Role, today: string): boolean {
  return actionQueue([agreement], role, today).some((item) => item.tone !== "waiting");
}

export function detailActions(
  agreement: Agreement,
  milestone: Milestone | undefined,
  role: Role,
  preview: WalletPreview,
  options?: { impersonate?: boolean },
): { primary: DetailAction | null; secondary: DetailAction[] } {
  const result = computeDetailActions(agreement, milestone, role, preview);
  if (options?.impersonate !== false) return result;
  const waiting = (action: DetailAction): DetailAction => {
    if (action.id !== "switch") return action;
    const who = action.demoSwitch === "freelancer" ? "the freelancer" : "the client";
    return { id: "switch", label: `Waiting on ${who}`, enabled: false, explanation: action.explanation };
  };
  return {
    primary: result.primary ? waiting(result.primary) : null,
    secondary: result.secondary.map(waiting),
  };
}

function computeDetailActions(
  agreement: Agreement,
  milestone: Milestone | undefined,
  role: Role,
  preview: WalletPreview,
): { primary: DetailAction | null; secondary: DetailAction[] } {
  const block = moneyBlockReason(preview);
  const secondary: DetailAction[] = [];
  const other: Role = role === "freelancer" ? "client" : "freelancer";
  const otherName = role === "freelancer" ? agreement.client.name : agreement.freelancer.name;

  if (agreement.status === "draft") {
    if (role !== "freelancer") return { primary: null, secondary };
    return {
      primary: { id: "edit", label: "Continue draft", enabled: true, explanation: "This draft has not been shared." },
      secondary,
    };
  }

  if (agreement.status === "awaiting_acceptance") {
    if (role === "client") {
      return {
        primary: {
          id: "accept",
          label: "Accept agreement",
          enabled: true,
          explanation: "Accepting binds you to this version of the terms. Milestones stay unfunded until you fund them.",
        },
        secondary,
      };
    }
    return {
      primary: {
        id: "switch",
        label: "Switch to client view",
        enabled: true,
        explanation: `${agreement.client.name} still needs to accept these terms. Funding stays closed until then.`,
        demoSwitch: "client",
      },
      secondary,
    };
  }

  if (!milestone) return { primary: null, secondary };

  if (milestone.phase === "paid") {
    return {
      primary: { id: "receipt", label: "View receipt", enabled: true, explanation: "Paid in full, once. This milestone cannot be paid again." },
      secondary,
    };
  }
  if (milestone.phase === "refunded") {
    return {
      primary: { id: "receipt", label: "View refund receipt", enabled: true, explanation: "Both people agreed to cancel. The full amount went back to the client." },
      secondary,
    };
  }

  if (milestone.phase === "cancellation_proposed" && milestone.cancellation) {
    if (milestone.cancellation.proposedBy !== role) {
      return {
        primary: {
          id: "respond_cancel",
          label: "Review cancellation",
          enabled: !block,
          explanation: block ?? `${milestone.cancellation.proposedBy === "client" ? agreement.client.name : agreement.freelancer.name} proposed a full refund. Funds stay held until you agree to this version.`,
        },
        secondary: [],
      };
    }
    return {
      primary: {
        id: "switch",
        label: role === "freelancer" ? "Switch to client view" : "Switch to freelancer view",
        enabled: true,
        explanation: "You opened this cancellation. Funds stay held until the other person agrees to this version.",
        demoSwitch: other,
      },
      secondary: [
        { id: "withdraw_cancel", label: "Withdraw proposal", enabled: true, explanation: "Withdrawing keeps the money held and returns the milestone to its previous step." },
        { id: "update_cancel", label: "Update proposal", enabled: true, explanation: "A new note replaces this proposal. The other person must agree to the new version." },
      ],
    };
  }

  if (fundsAreHeld(milestone.phase)) {
    secondary.push({
      id: "propose_cancel",
      label: "Propose cancellation",
      enabled: true,
      explanation: "Both people must agree before the full amount is refunded to the client. A proposal alone does not move funds.",
    });
  }

  if (milestone.phase === "unfunded") {
    if (role === "client") {
      return {
        primary: {
          id: "fund",
          label: "Fund milestone",
          enabled: !block,
          explanation: block ?? "Funding holds this amount for the milestone. You cannot take it back on your own.",
        },
        secondary,
      };
    }
    return {
      primary: {
        id: "switch",
        label: "Switch to client view",
        enabled: true,
        explanation: `${agreement.client.name} has not funded this milestone. The amount is not secured.`,
        demoSwitch: "client",
      },
      secondary,
    };
  }

  if (milestone.phase === "funded") {
    if (role === "freelancer") {
      return {
        primary: { id: "submit", label: "Submit work", enabled: true, explanation: "Funds are held. Submitting evidence does not release payment." },
        secondary,
      };
    }
    return {
      primary: {
        id: "switch",
        label: "Switch to freelancer view",
        enabled: true,
        explanation: `Waiting for ${agreement.freelancer.name} to submit. Funds are held.`,
        demoSwitch: "freelancer",
      },
      secondary,
    };
  }

  if (milestone.phase === "submitted") {
    if (role === "client") {
      return {
        primary: {
          id: "review",
          label: "Review submission",
          enabled: true,
          explanation: "Set the deliverables next to the evidence. Approval pays this milestone in full, once.",
        },
        secondary,
      };
    }
    return {
      primary: {
        id: "switch",
        label: "Switch to client view",
        enabled: true,
        explanation: `Waiting for ${agreement.client.name} to review. Funds stay held.`,
        demoSwitch: "client",
      },
      secondary,
    };
  }

  if (milestone.phase === "changes_requested") {
    if (role === "freelancer") {
      return {
        primary: { id: "submit", label: "Submit revision", enabled: true, explanation: "Earlier submissions stay on the record. A revision does not release payment." },
        secondary,
      };
    }
    return {
      primary: {
        id: "switch",
        label: "Switch to freelancer view",
        enabled: true,
        explanation: `Waiting for ${otherName} to resubmit. Funds stay held.`,
        demoSwitch: "freelancer",
      },
      secondary,
    };
  }

  return { primary: null, secondary };
}

export function phaseLabel(phase: MilestonePhase): string {
  switch (phase) {
    case "unfunded":
      return "Not funded";
    case "funded":
      return "Funds held";
    case "submitted":
      return "In review";
    case "changes_requested":
      return "Revision requested";
    case "cancellation_proposed":
      return "Cancellation proposed";
    case "paid":
      return "Paid";
    case "refunded":
      return "Refunded";
    default:
      return phase;
  }
}

export function agreementStatusLabel(status: AgreementStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "awaiting_acceptance":
      return "Awaiting acceptance";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function progressCopy(agreement: Agreement): string {
  if (agreement.status === "draft") {
    const count = agreement.draft?.milestones.length ?? 0;
    return count === 1 ? "Draft · 1 milestone" : `Draft · ${count} milestones`;
  }
  if (agreement.status === "awaiting_acceptance") return "Not accepted yet";
  const paid = agreement.milestones.filter((milestone) => milestone.phase === "paid").length;
  const refunded = agreement.milestones.filter((milestone) => milestone.phase === "refunded").length;
  const total = agreement.milestones.length;
  if (refunded > 0) return `${paid} of ${total} paid · ${refunded} refunded`;
  return `${paid} of ${total} paid`;
}

export function dueCopy(milestone: Milestone, today: string): string {
  if (milestone.phase === "paid" && milestone.paidAt) return `Paid ${formatDate(milestone.paidAt)}`;
  if (milestone.phase === "refunded" && milestone.refundedAt) return `Refunded ${formatDate(milestone.refundedAt)}`;
  if (isOverdue(milestone.dueDate, milestone.phase, today)) return `Due ${formatDate(milestone.dueDate)} · overdue`;
  return `Due ${formatDate(milestone.dueDate)}`;
}

export function matchesAgreementFilter(agreement: Agreement, filter: AgreementFilter, role: Role, today: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_you":
      return needsAttention(agreement, role, today);
    case "drafts":
      return agreement.status === "draft";
    case "acceptance":
      return agreement.status === "awaiting_acceptance";
    case "active":
      return agreement.status === "active";
    case "review":
      return agreement.milestones.some((milestone) => milestone.phase === "submitted");
    case "revision":
      return agreement.milestones.some((milestone) => milestone.phase === "changes_requested");
    case "unfunded":
      return agreement.status === "active" && agreement.milestones.some((milestone) => milestone.phase === "unfunded");
    case "settled":
      return agreement.status === "completed" || agreement.status === "cancelled";
    default:
      return true;
  }
}

export function agreementSearchText(agreement: Agreement): string {
  const milestoneText = agreement.milestones.map((milestone) => milestone.title).join(" ");
  const draftText = agreement.draft?.milestones.map((milestone) => milestone.title).join(" ") ?? "";
  return [agreement.title, agreement.description, agreement.client.name, agreement.freelancer.name, milestoneText, draftText]
    .join(" ")
    .toLowerCase();
}

export function latestSubmission(milestone: Milestone) {
  return milestone.submissions[milestone.submissions.length - 1];
}

export function revisionFor(milestone: Milestone, submissionId: string) {
  return milestone.revisionRequests.filter((request) => request.submissionId === submissionId);
}

export function confirmedEntry(ledger: LedgerEntry[], agreementId: string, milestoneId: string, kind: LedgerKind) {
  return ledger.find(
    (entry) =>
      entry.agreementId === agreementId &&
      entry.milestoneId === milestoneId &&
      entry.kind === kind &&
      entry.result === "confirmed",
  );
}

export function matchesLedgerFilter(entry: LedgerEntry, filter: LedgerFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "released":
      return entry.kind === "release" && entry.result === "confirmed";
    case "held":
      return entry.kind === "fund" && entry.result === "confirmed";
    case "refunded":
      return entry.kind === "refund" && entry.result === "confirmed";
    case "incomplete":
      return entry.result !== "confirmed";
    default:
      return true;
  }
}

export function ledgerLabel(entry: LedgerEntry, role: Role): string {
  if (entry.result === "rejected") return "Rejected";
  if (entry.result === "failed") return "Reverted";
  if (entry.result === "pending") return "Waiting for confirmation";
  if (entry.result === "unknown") return "Not verified yet";
  if (entry.kind === "fund") return "Funds held";
  if (entry.kind === "refund") return "Refunded";
  return role === "freelancer" ? "Paid to you" : "Paid out";
}

export function countByStatus(agreements: Agreement[], status: AgreementStatus): number {
  return agreements.filter((agreement) => agreement.status === status).length;
}

export function demoIdentity(state: DemoState): { name: string; detail: string } {
  if (state.role === "freelancer") {
    return { name: "Amara Cole", detail: "Freelancer · social and community" };
  }
  return { name: "Client view", detail: "You act as the client on each agreement" };
}
