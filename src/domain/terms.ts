import { fnv } from "./format";
import type { AgreementInput } from "./types";

export const PAYMENT_RULES = [
  "The client funds each milestone separately.",
  "Held funds stay in the agreement until the client approves that milestone.",
  "Approval pays the full milestone amount once.",
  "Submitting work does not release payment.",
  "A missed deadline does not pay or refund anyone.",
  "Cancelling a funded milestone takes both people and refunds the client in full.",
] as const;

export function termsReference(input: AgreementInput, freelancerWallet: string): string {
  const canonical = JSON.stringify({
    title: input.title.trim(),
    description: input.description.trim(),
    token: "tUSDC",
    clientName: input.clientName.trim(),
    clientWallet: input.clientWallet.trim().toLowerCase(),
    freelancerWallet: freelancerWallet.trim().toLowerCase(),
    milestones: input.milestones.map((milestone) => ({
      title: milestone.title.trim(),
      deliverables: milestone.deliverables.map((line) => line.trim()).filter(Boolean),
      amount: milestone.amount.trim(),
      dueDate: milestone.dueDate,
    })),
  });
  return `terms_${fnv(canonical)}`;
}
