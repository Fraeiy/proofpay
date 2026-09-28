import type { ReactNode } from "react";
import { Mark } from "./Wordmark";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="panel px-6 py-10 text-center">
      <Mark className="mx-auto h-12 w-12" title="" />
      <h2 className="mt-4 text-lg font-extrabold tracking-tight">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
