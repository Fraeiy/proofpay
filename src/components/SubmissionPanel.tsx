import { formatDateTime } from "../domain/format";
import { revisionFor } from "../domain/selectors";
import type { Milestone } from "../domain/types";
import { EmptyState } from "./EmptyState";

export function SubmissionPanel({ milestone }: { milestone: Milestone }) {
  if (milestone.submissions.length === 0) {
    return (
      <EmptyState
        title="No submission yet"
        body="When work is submitted, the note and evidence links stay here. ProofPay does not fetch those links."
      />
    );
  }
  const newestFirst = [...milestone.submissions].reverse();
  return (
    <div className="grid gap-3">
      {newestFirst.map((submission, index) => {
        const revisions = revisionFor(milestone, submission.id);
        return (
          <article key={submission.id} className="panel p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-extrabold">{index === 0 ? "Latest submission" : "Earlier submission"}</h3>
              <p className="text-sm text-muted">{formatDateTime(submission.submittedAt)}</p>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-[15px]">{submission.note}</p>
            <ul className="mt-3 grid gap-2">
              {submission.links.map((link) => (
                <li key={link.id}>
                  <a className="font-bold text-blue-ink underline decoration-2 underline-offset-2" href={link.url} target="_blank" rel="noreferrer noopener">
                    {link.label}
                  </a>
                  <p className="text-sm text-muted">Sample link. ProofPay does not fetch or embed it.</p>
                </li>
              ))}
            </ul>
            {revisions.map((revision) => (
              <div key={revision.id} className="mt-4 rounded-2xl border border-[var(--color-amber-line)] bg-amber-wash px-3 py-3 text-amber-ink">
                <p className="text-sm font-extrabold">Changes requested · {formatDateTime(revision.requestedAt)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{revision.reason}</p>
              </div>
            ))}
          </article>
        );
      })}
    </div>
  );
}
