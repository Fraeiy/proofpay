import { ChevronRight, CircleAlert, Clock3, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { cx } from "../domain/format";
import type { QueueItem } from "../domain/selectors";

const toneStyle = {
  action: "bg-blue-wash text-blue-ink",
  attention: "bg-amber-wash text-amber-ink",
  waiting: "bg-canvas text-muted",
} as const;

const toneIcon = {
  action: ListChecks,
  attention: CircleAlert,
  waiting: Clock3,
} as const;

export function ActionQueue({ items }: { items: QueueItem[] }) {
  return (
    <section className="panel min-w-0 overflow-hidden" aria-labelledby="next-up-title">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 id="next-up-title" className="font-extrabold">Next up</h2>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted sm:px-5">Nothing is waiting on you right now.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const Icon = toneIcon[item.tone];
            return (
              <li key={item.id} className="border-b border-line last:border-b-0">
                <Link to={item.href} className="flex min-h-[68px] items-center gap-3 px-4 py-3 no-underline hover:bg-canvas sm:px-5">
                  <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", toneStyle[item.tone])}>
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{item.title}</span>
                    <span className="block truncate text-sm text-muted">{item.detail}</span>
                  </span>
                  <span className="hidden shrink-0 text-sm font-bold sm:inline">{item.actionLabel}</span>
                  <ChevronRight size={18} aria-hidden className="shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
