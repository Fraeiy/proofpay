import { dueCopy } from "../domain/selectors";
import { cx, fundsAreHeld, isOverdue } from "../domain/format";
import type { Milestone } from "../domain/types";
import { Money } from "./Money";
import { HeldBadge, OverdueBadge, PhaseBadge } from "./StatusBadge";

export function MilestoneItem({
  milestone,
  selected,
  today,
  onSelect,
}: {
  milestone: Milestone;
  selected: boolean;
  today: string;
  onSelect: () => void;
}) {
  const overdue = isOverdue(milestone.dueDate, milestone.phase, today);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left",
        selected ? "border-ink bg-paper shadow-[3px_3px_0_var(--color-shadow)]" : "border-line bg-canvas hover:bg-paper",
      )}
    >
      <span className={cx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", selected ? "bg-blue" : "bg-line")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="font-extrabold">{milestone.title}</span>
          <Money cents={milestone.amount} size="sm" />
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5">
          <PhaseBadge phase={milestone.phase} />
          {fundsAreHeld(milestone.phase) && milestone.phase !== "funded" ? <HeldBadge /> : null}
          {overdue ? <OverdueBadge /> : null}
        </span>
        <span className="mt-2 block text-sm text-muted">{dueCopy(milestone, today)}</span>
      </span>
    </button>
  );
}
