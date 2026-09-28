import type { ReactNode } from "react";
import { CircleCheck, FileText, Hourglass, RotateCcw, TriangleAlert, Wallet } from "lucide-react";
import { cx } from "../domain/format";
import { agreementStatusLabel, phaseLabel } from "../domain/selectors";
import type { AgreementStatus, MilestonePhase } from "../domain/types";

const tones = {
  neutral: "border-line bg-canvas text-ink",
  info: "border-[var(--color-blue-line)] bg-blue-wash text-blue-ink",
  positive: "border-ink/10 bg-lime text-anchor",
  attention: "border-[var(--color-amber-line)] bg-amber-wash text-amber-ink",
  danger: "border-[var(--color-coral-line)] bg-coral-wash text-coral-ink",
} as const;

function Badge({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-bold leading-none", tones[tone])}>
      {children}
    </span>
  );
}

const phaseTone: Record<MilestonePhase, keyof typeof tones> = {
  unfunded: "neutral",
  funded: "info",
  submitted: "info",
  changes_requested: "attention",
  cancellation_proposed: "attention",
  paid: "positive",
  refunded: "neutral",
};

const phaseIcon = {
  unfunded: Hourglass,
  funded: Wallet,
  submitted: FileText,
  changes_requested: TriangleAlert,
  cancellation_proposed: TriangleAlert,
  paid: CircleCheck,
  refunded: RotateCcw,
} satisfies Record<MilestonePhase, typeof Hourglass>;

export function PhaseBadge({ phase }: { phase: MilestonePhase }) {
  const Icon = phaseIcon[phase];
  return (
    <Badge tone={phaseTone[phase]}>
      <Icon size={13} aria-hidden />
      {phaseLabel(phase)}
    </Badge>
  );
}

export function HeldBadge() {
  return (
    <Badge tone="info">
      <Wallet size={13} aria-hidden />
      Funds held
    </Badge>
  );
}

export function OverdueBadge() {
  return (
    <Badge tone="attention">
      <TriangleAlert size={13} aria-hidden />
      Overdue
    </Badge>
  );
}

export function AgreementBadge({ status }: { status: AgreementStatus }) {
  const tone = status === "completed" ? "positive" : status === "cancelled" ? "danger" : status === "awaiting_acceptance" ? "attention" : "neutral";
  return <Badge tone={tone}>{agreementStatusLabel(status)}</Badge>;
}
