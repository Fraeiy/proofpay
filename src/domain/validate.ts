import { isWallet, parseAmountToCents, todayISO } from "./format";
import type { AgreementInput, FieldErrors, MilestoneInput } from "./types";

const MAX_MILESTONES = 8;
const MAX_DELIVERABLES = 8;

export function emptyMilestone(id: string): MilestoneInput {
  return { id, title: "", deliverables: [""], amount: "", dueDate: "" };
}

export function emptyAgreement(firstMilestoneId: string): AgreementInput {
  return {
    title: "",
    clientName: "",
    clientWallet: "",
    description: "",
    milestones: [emptyMilestone(firstMilestoneId)],
  };
}

export function validateAgreementInput(
  input: AgreementInput,
  freelancerWallet: string,
  today = todayISO(),
): FieldErrors {
  const errors: FieldErrors = {};
  const title = input.title.trim();
  if (title.length < 3) errors.title = "Add a title of at least 3 characters.";
  else if (title.length > 80) errors.title = "Keep the title under 80 characters.";

  const clientName = input.clientName.trim();
  if (clientName.length < 2) errors.clientName = "Add the client’s name.";
  else if (clientName.length > 60) errors.clientName = "Keep the client name under 60 characters.";

  const wallet = input.clientWallet.trim();
  if (!wallet) errors.clientWallet = "Add the client wallet address.";
  else if (!isWallet(wallet)) errors.clientWallet = "Enter a wallet address: 0x followed by 40 hex characters.";
  else if (wallet.toLowerCase() === freelancerWallet.trim().toLowerCase()) {
    errors.clientWallet = "The client wallet needs to be different from the freelancer wallet.";
  }

  const description = input.description.trim();
  if (description.length < 20) errors.description = "Describe the work in at least 20 characters.";
  else if (description.length > 600) errors.description = "Keep the description under 600 characters.";

  if (input.milestones.length < 1) errors.milestones = "Add at least one milestone.";
  if (input.milestones.length > MAX_MILESTONES) errors.milestones = "Use 8 milestones or fewer.";

  input.milestones.forEach((milestone, index) => {
    const prefix = `milestone.${index}`;
    if (milestone.title.trim().length < 3) errors[`${prefix}.title`] = "Add a milestone title.";
    const deliverables = milestone.deliverables.map((line) => line.trim()).filter(Boolean);
    if (deliverables.length < 1) errors[`${prefix}.deliverables`] = "Add at least one specific deliverable.";
    if (milestone.deliverables.length > MAX_DELIVERABLES) {
      errors[`${prefix}.deliverables`] = "Use 8 deliverables or fewer.";
    }
    if (parseAmountToCents(milestone.amount) == null) {
      errors[`${prefix}.amount`] = "Enter an amount greater than 0, with at most 2 decimal places.";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(milestone.dueDate)) errors[`${prefix}.dueDate`] = "Choose a due date.";
    else if (milestone.dueDate < today) errors[`${prefix}.dueDate`] = "Choose today or a later date. Deadlines do not move funds.";
  });

  return errors;
}

export function firstErrorKey(errors: FieldErrors): string | undefined {
  const preferred = ["title", "clientName", "clientWallet", "description", "milestones"];
  for (const key of preferred) {
    if (errors[key]) return key;
  }
  return Object.keys(errors)[0];
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
