import { describe, expect, it } from "vitest";
import { memoryRepository } from "../demo/repository";
import { buildSeed } from "../demo/seed";
import { AMARA, NORTHLINE } from "../demo/people";
import { summarize } from "./selectors";
import {
  acceptAgreement,
  approveCancellation,
  declineCancellation,
  fundMilestone,
  proposeCancellation,
  recordAttempt,
  releasePayment,
  replaceCancellation,
  requestChanges,
  shareDraft,
  submitWork,
  upsertDraft,
} from "./rules";
import { emptyAgreement } from "./validate";
import type { DemoState } from "./types";

const clock = { now: "2026-09-28T12:00:00", id: (prefix: string) => `${prefix}_test` };

function seed(): DemoState {
  return buildSeed();
}

describe("demo money rules", () => {
  it("keeps unfunded and unaccepted amounts out of held funds", () => {
    const state = seed();
    const totals = summarize(state.agreements);
    expect(totals.held).toBe(202000);
    expect(totals.awaiting).toBe(137000);
    expect(totals.paid).toBe(84000);
    const drafted = upsertDraft(state, null, emptyAgreement("ms_new"), AMARA, clock);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(summarize(drafted.state.agreements)).toEqual(totals);
  });

  it("refuses funding before both parties accept", () => {
    const state = seed();
    const drafted = upsertDraft(state, null, {
      ...emptyAgreement("ms_new"),
      title: "Launch help",
      clientName: "Northline Labs",
      clientWallet: NORTHLINE.wallet,
      description: "A short research note and a shared link for the client.",
      milestones: [{ id: "ms_new", title: "Research note", deliverables: ["One research note"], amount: "100.00", dueDate: "2026-10-01" }],
    }, AMARA, clock);
    if (!drafted.ok || !drafted.id) throw new Error("draft");
    const shared = shareDraft(drafted.state, drafted.id, AMARA.wallet, clock);
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    const funded = fundMilestone(shared.state, drafted.id, "ms_new", "client", clock);
    expect(funded.ok).toBe(false);
    const accepted = acceptAgreement(shared.state, drafted.id, "client", shared.state.agreements.find((item) => item.id === drafted.id)?.termsRef ?? "", clock);
    expect(accepted.ok).toBe(true);
  });

  it("lets only the client fund once, and only the freelancer submit", () => {
    const state = seed();
    expect(fundMilestone(state, "agr_northline", "ms_n4", "freelancer", clock).ok).toBe(false);
    const funded = fundMilestone(state, "agr_northline", "ms_n4", "client", clock);
    expect(funded.ok).toBe(true);
    if (!funded.ok) return;
    expect(fundMilestone(funded.state, "agr_northline", "ms_n4", "client", clock).ok).toBe(false);
    expect(submitWork(funded.state, { agreementId: "agr_northline", milestoneId: "ms_n4", role: "client", note: "A long enough note.", links: [{ label: "Report", url: "https://example.com/r" }] }, clock).ok).toBe(false);
    const submitted = submitWork(funded.state, { agreementId: "agr_northline", milestoneId: "ms_n4", role: "freelancer", note: "Sample report for the new week.", links: [{ label: "Report", url: "https://example.com/r" }] }, clock);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    const milestone = submitted.state.agreements[0]?.milestones.find((item) => item.id === "ms_n4");
    expect(milestone?.phase).toBe("submitted");
    expect(milestone?.submissions).toHaveLength(1);
    expect(summarize(submitted.state.agreements).paid).toBe(84000);
  });

  it("pays a milestone once and keeps the revision history", () => {
    const state = seed();
    expect(releasePayment(state, "agr_harbor", "ms_h1", "client", clock).ok).toBe(false);
    const revised = submitWork(state, {
      agreementId: "agr_harbor",
      milestoneId: "ms_h1",
      role: "freelancer",
      note: "Updated the opening and the end card.",
      links: [{ label: "Product story v2", url: "https://example.com/harbor/v2" }],
    }, clock);
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    const beforePay = revised.state.agreements.find((item) => item.id === "agr_harbor")?.milestones[0];
    expect(beforePay?.submissions).toHaveLength(2);
    expect(beforePay?.revisionRequests).toHaveLength(1);
    const paid = releasePayment(revised.state, "agr_harbor", "ms_h1", "client", clock);
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(releasePayment(paid.state, "agr_harbor", "ms_h1", "client", clock).ok).toBe(false);
    expect(summarize(paid.state.agreements).paid).toBe(149000);
  });

  it("requests changes without releasing funds", () => {
    const state = seed();
    const changed = requestChanges(state, { agreementId: "agr_northline", milestoneId: "ms_n3", role: "client", reason: "Please add the three reply links to the report." }, clock);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const milestone = changed.state.agreements[0]?.milestones.find((item) => item.id === "ms_n3");
    expect(milestone?.phase).toBe("changes_requested");
    expect(milestone?.submissions).toHaveLength(1);
    expect(summarize(changed.state.agreements).held).toBe(202000);
    expect(summarize(changed.state.agreements).paid).toBe(84000);
  });

  it("refunds only when the other party approves the current proposal", () => {
    const state = seed();
    const proposal = state.agreements.find((item) => item.id === "agr_lumen")?.milestones[0]?.cancellation;
    expect(proposal).toBeTruthy();
    expect(approveCancellation(state, { agreementId: "agr_lumen", milestoneId: "ms_l1", role: "client", proposalId: proposal?.id ?? "" }, clock).ok).toBe(false);
    const replaced = replaceCancellation(state, { agreementId: "agr_lumen", milestoneId: "ms_l1", role: "client", proposalId: proposal?.id ?? "", note: "Please refund the full welcome-guide milestone." }, { ...clock, id: (prefix) => `${prefix}_next` });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(approveCancellation(replaced.state, { agreementId: "agr_lumen", milestoneId: "ms_l1", role: "freelancer", proposalId: proposal?.id ?? "" }, clock).ok).toBe(false);
    const approved = approveCancellation(replaced.state, { agreementId: "agr_lumen", milestoneId: "ms_l1", role: "freelancer", proposalId: replaced.id ?? "" }, clock);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const milestone = approved.state.agreements.find((item) => item.id === "agr_lumen")?.milestones[0];
    expect(milestone?.phase).toBe("refunded");
    expect(milestone?.amount).toBe(30000);
    expect(summarize(approved.state.agreements).refunded).toBe(30000);
    expect(summarize(approved.state.agreements).held).toBe(172000);
    expect(approveCancellation(approved.state, { agreementId: "agr_lumen", milestoneId: "ms_l1", role: "freelancer", proposalId: replaced.id ?? "" }, clock).ok).toBe(false);
  });

  it("restores the previous phase when a proposal is declined", () => {
    const state = seed();
    const proposalId = state.agreements.find((item) => item.id === "agr_lumen")?.milestones[0]?.cancellation?.id ?? "";
    const declined = declineCancellation(state, { agreementId: "agr_lumen", milestoneId: "ms_l1", role: "freelancer", proposalId });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    const milestone = declined.state.agreements.find((item) => item.id === "agr_lumen")?.milestones[0];
    expect(milestone?.phase).toBe("funded");
    expect(milestone?.cancellation).toBeUndefined();
    expect(summarize(declined.state.agreements).held).toBe(202000);
  });

  it("does not move money when a transaction fails, and a deadline does not pay", () => {
    const state = seed();
    const failed = recordAttempt(state, { agreementId: "agr_northline", milestoneId: "ms_n4", kind: "fund", result: "failed" }, clock);
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.state.agreements[0]?.milestones.find((item) => item.id === "ms_n4")?.phase).toBe("unfunded");
    expect(summarize(failed.state.agreements)).toEqual(summarize(state.agreements));
    const overdue = state.agreements.find((item) => item.id === "agr_harbor")?.milestones[0];
    expect(overdue?.phase).toBe("changes_requested");
    expect((overdue?.dueDate ?? "") < "2026-09-28").toBe(true);
  });

  it("rejects a second proposal on an unfunded milestone and a paid milestone", () => {
    const state = seed();
    expect(proposeCancellation(state, { agreementId: "agr_northline", milestoneId: "ms_n4", role: "client", note: "Please cancel this unfunded week." }, clock).ok).toBe(false);
    expect(proposeCancellation(state, { agreementId: "agr_northline", milestoneId: "ms_n1", role: "client", note: "Please cancel this paid week now." }, clock).ok).toBe(false);
  });
});

describe("demo repository", () => {
  it("resets to the seed instead of keeping edits", () => {
    const repository = memoryRepository();
    const edited = fundMilestone(repository.load(), "agr_northline", "ms_n4", "client", clock);
    if (!edited.ok) throw new Error("fund");
    repository.save(edited.state);
    expect(repository.load().agreements[0]?.milestones.find((item) => item.id === "ms_n4")?.phase).toBe("funded");
    expect(repository.reset().agreements[0]?.milestones.find((item) => item.id === "ms_n4")?.phase).toBe("unfunded");
  });
});
