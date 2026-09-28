import { addDays, createId } from "../domain/format";
import type { AgreementInput } from "../domain/types";

export function weeklySocialTemplate(today: string): AgreementInput {
  const milestone = (title: string, deliverables: string[], days: number): AgreementInput["milestones"][number] => ({
    id: createId("ms"),
    title,
    deliverables,
    amount: "400.00",
    dueDate: addDays(today, days),
  });

  return {
    title: "Weekly social management",
    clientName: "",
    clientWallet: "",
    description:
      "Four weeks of social posts, community replies, and a written activity report. Each week has its own deliverables and its own payment. Due dates are reminders. They do not release or refund funds.",
    milestones: [
      milestone("Week 1 · Launch posts", ["Publish five launch posts", "Reply on four weekdays and keep a log", "Share a one-page activity report"], 7),
      milestone("Week 2 · Community threads", ["Publish two community threads", "Post a weekly recap", "Share the reply log and links"], 14),
      milestone("Week 3 · Recap and report", ["Highlight three community replies", "Post one recap", "Share the activity report with links"], 21),
      milestone("Week 4 · Monthly report", ["Publish the monthly activity report", "List what shipped each week", "Note anything still open"], 28),
    ],
  };
}
