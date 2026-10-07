export type Role = "freelancer" | "client";

export type AgreementStatus = "draft" | "awaiting_acceptance" | "active" | "completed" | "cancelled";

export type MilestonePhase =
  | "unfunded"
  | "funded"
  | "submitted"
  | "changes_requested"
  | "paid"
  | "cancellation_proposed"
  | "refunded";

export type HeldPhase = "funded" | "submitted" | "changes_requested";

export type TxOutcome = "success" | "rejected" | "failed";

export type WalletPreview = "demo" | "disconnected" | "wrong_network";

export type LedgerKind = "fund" | "release" | "refund";

export type LedgerResult = "confirmed" | "rejected" | "failed" | "pending" | "unknown";

export type Party = {
  name: string;
  role: Role;
  wallet: string;
};

export type Deliverable = {
  id: string;
  text: string;
};

export type EvidenceLink = {
  id: string;
  label: string;
  url: string;
};

export type Submission = {
  id: string;
  note: string;
  links: EvidenceLink[];
  submittedAt: string;
};

export type RevisionRequest = {
  id: string;
  submissionId: string;
  reason: string;
  requestedAt: string;
};

export type CancellationProposal = {
  id: string;
  proposedBy: Role;
  note: string;
  proposedAt: string;
  basePhase: HeldPhase;
};

export type Milestone = {
  id: string;
  title: string;
  deliverables: Deliverable[];
  amount: number;
  dueDate: string;
  phase: MilestonePhase;
  fundedAt?: string;
  paidAt?: string;
  refundedAt?: string;
  submissions: Submission[];
  revisionRequests: RevisionRequest[];
  cancellation?: CancellationProposal;
};

export type MilestoneInput = {
  id: string;
  title: string;
  deliverables: string[];
  amount: string;
  dueDate: string;
};

export type AgreementInput = {
  title: string;
  clientName: string;
  clientWallet: string;
  description: string;
  milestones: MilestoneInput[];
};

export type Agreement = {
  id: string;
  title: string;
  description: string;
  status: AgreementStatus;
  freelancer: Party;
  client: Party;
  termsRef: string;
  chainAgreementId?: string;
  freelancerAcceptedAt?: string;
  clientAcceptedAt?: string;
  sharedAt?: string;
  createdAt: string;
  milestones: Milestone[];
  draft: AgreementInput | null;
  invitation?: {
    expiresAt: string;
    claimedWallet: string;
    confirmed: boolean;
    expired: boolean;
  };
};

export type LedgerEntry = {
  id: string;
  agreementId: string;
  milestoneId: string;
  kind: LedgerKind;
  result: LedgerResult;
  amount: number;
  fromName: string;
  fromWallet: string;
  toName: string;
  toWallet: string;
  at: string;
  reference: string;
  simulated: boolean;
  detail: string;
  txHash?: string;
  chainId?: number;
  logIndex?: number;
  explorerUrl?: string;
};

export type DemoState = {
  version: 1;
  role: Role;
  walletPreview: WalletPreview;
  nextOutcome: TxOutcome;
  agreements: Agreement[];
  ledger: LedgerEntry[];
};

export type FieldErrors = Record<string, string>;

export type ApplyOk = { ok: true; state: DemoState; id?: string; entryId?: string };
export type ApplyFail = { ok: false; error: string; state: DemoState; errors?: FieldErrors };
export type ApplyResult = ApplyOk | ApplyFail;
