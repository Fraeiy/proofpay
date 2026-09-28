import { Link } from "react-router-dom";
import { fundsAreHeld, isOverdue } from "../domain/format";
import { dueCopy, milestoneHref, progressCopy } from "../domain/selectors";
import type { Agreement, Milestone, Role } from "../domain/types";
import { Money } from "./Money";
import { AgreementBadge, HeldBadge, OverdueBadge, PhaseBadge } from "./StatusBadge";

function Progress({ agreement }: { agreement: Agreement }) {
  const total = agreement.milestones.length || agreement.draft?.milestones.length || 0;
  const paid = agreement.milestones.filter((milestone) => milestone.phase === "paid").length;
  const width = total === 0 ? 0 : Math.round((paid / total) * 100);
  return (
    <div className="min-w-0">
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full bg-ink" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-1 text-[13px] text-muted">{progressCopy(agreement)}</p>
    </div>
  );
}

export function AgreementRow({
  agreement,
  milestone,
  role,
  today,
  action,
}: {
  agreement: Agreement;
  milestone?: Milestone;
  role: Role;
  today: string;
  action: string;
}) {
  const href = agreement.status === "draft" ? `/agreements/${agreement.id}/edit` : milestoneHref(agreement.id, milestone?.id);
  const party = role === "freelancer" ? agreement.client.name : agreement.freelancer.name;
  return (
    <Link to={href} className="block min-w-0 px-4 py-3.5 no-underline hover:bg-canvas">
      <span className="flex min-w-0 items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block font-extrabold">{agreement.title}</span>
          <span className="mt-0.5 block text-sm text-muted">with {party}</span>
        </span>
        <span className="shrink-0 pt-0.5 text-sm font-extrabold text-blue-ink">{action}</span>
      </span>
      <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="font-bold">{milestone?.title ?? "Not shared"}</span>
        {agreement.status === "active" && milestone ? <PhaseBadge phase={milestone.phase} /> : <AgreementBadge status={agreement.status} />}
        {milestone && isOverdue(milestone.dueDate, milestone.phase, today) ? <OverdueBadge /> : null}
        <span className="text-muted">{milestone ? dueCopy(milestone, today) : "Draft"}</span>
      </span>
      <span className="mt-2 block max-w-md"><Progress agreement={agreement} /></span>
    </Link>
  );
}

export function AgreementCard({
  agreement,
  milestone,
  role,
  today,
  action,
}: {
  agreement: Agreement;
  milestone?: Milestone;
  role: Role;
  today: string;
  action: string;
}) {
  const href = agreement.status === "draft" ? `/agreements/${agreement.id}/edit` : milestoneHref(agreement.id, milestone?.id);
  const party = role === "freelancer" ? agreement.client.name : agreement.freelancer.name;
  return (
    <article className="panel min-w-0 overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-extrabold tracking-tight">{agreement.title}</h3>
          <p className="text-sm text-muted">with {party}</p>
        </div>
        {milestone ? <Money cents={milestone.amount} size="sm" /> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {agreement.status === "active" && milestone ? <PhaseBadge phase={milestone.phase} /> : <AgreementBadge status={agreement.status} />}
        {milestone && fundsAreHeld(milestone.phase) && milestone.phase !== "funded" ? <HeldBadge /> : null}
        {milestone && isOverdue(milestone.dueDate, milestone.phase, today) ? <OverdueBadge /> : null}
      </div>
      <p className="mt-3 text-sm">
        <span className="font-bold">{milestone?.title ?? "Draft"}</span>
        <span className="text-muted"> · {milestone ? dueCopy(milestone, today) : "Not shared"}</span>
      </p>
      <div className="mt-3"><Progress agreement={agreement} /></div>
      <Link to={href} className="btn btn-ghost btn-block mt-4">{action}</Link>
    </article>
  );
}
