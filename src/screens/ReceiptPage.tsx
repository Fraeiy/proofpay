import { Link, useParams } from "react-router-dom";
import { ReceiptView } from "../components/ReceiptView";
import { EmptyState } from "../components/EmptyState";
import { ButtonLink, usePageTitle } from "../components/ui";
import { useDemo } from "../demo/store";

export function ReceiptPage() {
  const { entryId } = useParams();
  const demo = useDemo();
  const entry = demo.state.ledger.find((item) => item.id === entryId);
  const agreement = demo.state.agreements.find((item) => item.id === entry?.agreementId);
  const milestone = agreement?.milestones.find((item) => item.id === entry?.milestoneId);
  usePageTitle(entry?.result === "confirmed" ? "Receipt" : "Attempt");

  if (!entry) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <EmptyState title="No receipt here" body={demo.mode === "live" ? "That record is not on this account." : "That simulated record is not in this browser’s sample."} action={<ButtonLink to="/payments" variant="ink">Back to payments</ButtonLink>} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-6">
      <Link to="/payments" className="text-sm font-bold text-blue-ink">Payments</Link>
      <h1 className="mt-2 text-[26px] font-extrabold tracking-tight">{entry.result !== "confirmed" ? "Attempt" : entry.kind === "fund" ? "Deposit confirmation" : entry.kind === "refund" ? "Refund confirmation" : "Receipt"}</h1>
      <div className="mt-5">
        <ReceiptView entry={entry} agreement={agreement} milestoneTitle={milestone?.title ?? "Milestone"} role={agreement ? demo.actingRole(agreement) : demo.state.role} onDownload={entry.result === "confirmed" ? () => void demo.downloadReceipt(entry.id) : undefined} />
      </div>
    </div>
  );
}
