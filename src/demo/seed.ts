import { simulatedReference } from "../domain/format";
import { termsReference } from "../domain/terms";
import type { Agreement, AgreementInput, DemoState, LedgerEntry, Milestone, Party, Submission } from "../domain/types";
import { AMARA, HARBOR, LUMEN, NORTHLINE } from "./people";

function deliverables(id: string, lines: string[]): Milestone["deliverables"] {
  return lines.map((text, index) => ({ id: `${id}_d${index + 1}`, text }));
}

function milestone(
  id: string,
  title: string,
  lines: string[],
  amount: number,
  dueDate: string,
  extra: Partial<Milestone> = {},
): Milestone {
  return {
    id,
    title,
    deliverables: deliverables(id, lines),
    amount,
    dueDate,
    phase: "unfunded",
    submissions: [],
    revisionRequests: [],
    ...extra,
  };
}

function submission(id: string, note: string, submittedAt: string, links: Array<[string, string]>): Submission {
  return {
    id,
    note,
    submittedAt,
    links: links.map(([label, url], index) => ({ id: `${id}_l${index + 1}`, label, url })),
  };
}

function formFor(title: string, description: string, client: Party, rows: Milestone[]): AgreementInput {
  return {
    title,
    description,
    clientName: client.name,
    clientWallet: client.wallet,
    milestones: rows.map((row) => ({
      id: row.id,
      title: row.title,
      deliverables: row.deliverables.map((item) => item.text),
      amount: (row.amount / 100).toFixed(2),
      dueDate: row.dueDate,
    })),
  };
}

function agreement(input: {
  id: string;
  title: string;
  description: string;
  client: Party;
  createdAt: string;
  acceptedAt: string;
  milestones: Milestone[];
}): Agreement {
  const form = formFor(input.title, input.description, input.client, input.milestones);
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    status: "active",
    freelancer: AMARA,
    client: input.client,
    termsRef: termsReference(form, AMARA.wallet),
    freelancerAcceptedAt: input.acceptedAt,
    clientAcceptedAt: input.acceptedAt,
    sharedAt: input.createdAt,
    createdAt: input.createdAt,
    milestones: input.milestones,
    draft: null,
  };
}

function entry(
  id: string,
  agreementId: string,
  milestoneId: string,
  kind: LedgerEntry["kind"],
  amount: number,
  fromName: string,
  fromWallet: string,
  toName: string,
  toWallet: string,
  at: string,
  detail: string,
): LedgerEntry {
  return {
    id,
    agreementId,
    milestoneId,
    kind,
    result: "confirmed",
    amount,
    fromName,
    fromWallet,
    toName,
    toWallet,
    at,
    reference: simulatedReference(id),
    simulated: true,
    detail,
  };
}

const northlineMilestones: Milestone[] = [
  milestone("ms_n1", "Week 1 · Launch posts", ["Publish five launch posts", "Reply on four weekdays and keep a log", "Share a one-page activity report"], 42000, "2026-09-06", {
    phase: "paid",
    fundedAt: "2026-09-02T10:00:00",
    paidAt: "2026-09-07T15:10:00",
    submissions: [
      submission("sub_n1", "Sample activity report. Published the launch calendar and five posts. The reply log is in the shared document.", "2026-09-06T17:00:00", [
        ["Activity report (sample)", "https://example.com/northline/week-1-report"],
        ["Launch thread (sample)", "https://example.com/northline/launch-thread"],
      ]),
    ],
  }),
  milestone("ms_n2", "Week 2 · Community threads", ["Publish two community threads", "Post a weekly recap", "Share the reply log and links"], 42000, "2026-09-13", {
    phase: "paid",
    fundedAt: "2026-09-07T15:20:00",
    paidAt: "2026-09-13T18:05:00",
    submissions: [
      submission("sub_n2", "Sample activity report. Two community threads and the weekly recap are published. Links are below.", "2026-09-12T16:40:00", [
        ["Activity report (sample)", "https://example.com/northline/week-2-report"],
      ]),
    ],
  }),
  milestone("ms_n3", "Week 3 · Recap and report", ["Highlight three community replies", "Post one recap", "Share the activity report with links"], 42000, "2026-09-30", {
    phase: "submitted",
    fundedAt: "2026-09-14T11:00:00",
    submissions: [
      submission("sub_n3", "Sample activity report for week 3. Three community replies, one recap post, and the link list.", "2026-09-26T19:12:00", [
        ["Week 3 activity report (sample)", "https://example.com/northline/week-3-report"],
        ["Recap post (sample)", "https://example.com/northline/week-3-recap"],
      ]),
    ],
  }),
  milestone("ms_n4", "Week 4 · Monthly report", ["Publish the monthly activity report", "List what shipped each week", "Note anything still open"], 42000, "2026-10-07"),
];

const harborMilestones: Milestone[] = [
  milestone("ms_h1", "Product story", ["A 45–60 second product story", "An end card with the testnet date", "A link to the cut"], 65000, "2026-09-20", {
    phase: "changes_requested",
    fundedAt: "2026-09-11T09:30:00",
    submissions: [
      submission("sub_h1", "Sample cut. The first version of the product story is in the shared folder.", "2026-09-17T13:20:00", [
        ["Product story v1 (sample)", "https://example.com/harbor/product-story-v1"],
      ]),
    ],
    revisionRequests: [
      {
        id: "rev_h1",
        submissionId: "sub_h1",
        requestedAt: "2026-09-20T10:15:00",
        reason: "The opening does not mention the testnet date, and the end card still says “coming soon”. Please update those two frames and resubmit.",
      },
    ],
  }),
  milestone("ms_h2", "Founder cut", ["A 30 second founder voiceover", "Captions on the cut", "A link to the cut"], 65000, "2026-10-02", {
    phase: "funded",
    fundedAt: "2026-09-16T12:00:00",
  }),
  milestone("ms_h3", "Launch cut", ["A 20 second launch announcement", "The date and link on screen", "A link to the cut"], 65000, "2026-10-16"),
];

const lumenMilestones: Milestone[] = [
  milestone("ms_l1", "Welcome guide", ["A one-page welcome guide", "An agenda for a 30-minute office hour", "A link to the guide"], 30000, "2026-09-25", {
    phase: "cancellation_proposed",
    fundedAt: "2026-09-19T14:00:00",
    cancellation: {
      id: "can_l1",
      proposedBy: "client",
      proposedAt: "2026-09-26T09:40:00",
      basePhase: "funded",
      note: "We paused onboarding before any delivery. Please agree to refund this funded milestone in full.",
    },
  }),
  milestone("ms_l2", "Moderator handoff", ["A moderator checklist", "Introductions for two moderators", "A link to the checklist"], 30000, "2026-10-09"),
];

const northline = agreement({
  id: "agr_northline",
  title: "Northline four-week social",
  description: "Four weeks of social posts, community replies, and a written activity report for Northline’s testnet launch. Each week is funded and paid on its own. A due date is a reminder. It does not release or refund funds.",
  client: NORTHLINE,
  createdAt: "2026-09-01T09:00:00",
  acceptedAt: "2026-09-01T11:30:00",
  milestones: northlineMilestones,
});

const harbor = agreement({
  id: "agr_harbor",
  title: "Harbor three-video package",
  description: "Three short videos for Harbor Studio’s testnet launch: a product story, a founder cut, and a launch cut. Each video is its own milestone, with a link and a short note when it is delivered.",
  client: HARBOR,
  createdAt: "2026-09-10T09:00:00",
  acceptedAt: "2026-09-10T15:00:00",
  milestones: harborMilestones,
});

const lumen = agreement({
  id: "agr_lumen",
  title: "Lumen community onboarding",
  description: "A welcome guide for new community members and one live office hour, then a moderator handoff. The first milestone is funded. Lumen has proposed cancelling it. Funds stay held until Amara agrees.",
  client: LUMEN,
  createdAt: "2026-09-18T09:00:00",
  acceptedAt: "2026-09-18T16:10:00",
  milestones: lumenMilestones,
});

const held = (name: string) => `Held for ${name}`;

export function buildSeed(): DemoState {
  const ledger: LedgerEntry[] = [
    entry("led_n3_fund", northline.id, "ms_n3", "fund", 42000, NORTHLINE.name, NORTHLINE.wallet, held(AMARA.name), AMARA.wallet, "2026-09-14T11:00:00", "Funded “Week 3 · Recap and report”. The amount is held, not paid out."),
    entry("led_h2_fund", harbor.id, "ms_h2", "fund", 65000, HARBOR.name, HARBOR.wallet, held(AMARA.name), AMARA.wallet, "2026-09-16T12:00:00", "Funded “Founder cut”. The amount is held, not paid out."),
    entry("led_l1_fund", lumen.id, "ms_l1", "fund", 30000, LUMEN.name, LUMEN.wallet, held(AMARA.name), AMARA.wallet, "2026-09-19T14:00:00", "Funded “Welcome guide”. The amount is held, not paid out."),
    entry("led_n2_pay", northline.id, "ms_n2", "release", 42000, NORTHLINE.name, NORTHLINE.wallet, AMARA.name, AMARA.wallet, "2026-09-13T18:05:00", "Released the full amount for “Week 2 · Community threads”."),
    entry("led_h1_fund", harbor.id, "ms_h1", "fund", 65000, HARBOR.name, HARBOR.wallet, held(AMARA.name), AMARA.wallet, "2026-09-11T09:30:00", "Funded “Product story”. The amount is held, not paid out."),
    entry("led_n2_fund", northline.id, "ms_n2", "fund", 42000, NORTHLINE.name, NORTHLINE.wallet, held(AMARA.name), AMARA.wallet, "2026-09-07T15:20:00", "Funded “Week 2 · Community threads”. The amount is held, not paid out."),
    entry("led_n1_pay", northline.id, "ms_n1", "release", 42000, NORTHLINE.name, NORTHLINE.wallet, AMARA.name, AMARA.wallet, "2026-09-07T15:10:00", "Released the full amount for “Week 1 · Launch posts”."),
    entry("led_n1_fund", northline.id, "ms_n1", "fund", 42000, NORTHLINE.name, NORTHLINE.wallet, held(AMARA.name), AMARA.wallet, "2026-09-02T10:00:00", "Funded “Week 1 · Launch posts”. The amount is held, not paid out."),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    version: 1,
    role: "freelancer",
    walletPreview: "demo",
    nextOutcome: "success",
    agreements: [northline, harbor, lumen],
    ledger,
  };
}
