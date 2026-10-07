import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nowIso, prefersReducedMotion, wait } from "../domain/format";
import {
  acceptAgreement,
  approveCancellation,
  declineCancellation,
  deleteDraft,
  fundMilestone,
  proposeCancellation,
  recordAttempt,
  releasePayment,
  replaceCancellation,
  requestChanges,
  shareDraft,
  submitWork,
  upsertDraft,
} from "../domain/rules";
import { moneyBlockReason } from "../domain/selectors";
import type { Agreement, AgreementInput, DemoState, FieldErrors, LedgerKind, Role, TxOutcome, WalletPreview } from "../domain/types";
import type { ThemeChoice } from "../theme";
import { AMARA } from "./people";
import { browserDemoRepository, type DemoRepository } from "./repository";

export type Notice = {
  tone: "ok" | "danger";
  title: string;
  detail?: string;
};

export type TxPhase = "awaiting" | "submitted" | "pending" | "success" | "rejected" | "failed" | "unknown";

export type TxView = {
  phase: TxPhase;
  kind: LedgerKind;
  agreementId: string;
  milestoneId: string;
  entryId?: string;
  title: string;
};

export type Profile = {
  wallet: string;
  wallets?: string[];
  displayName: string;
  intent: "freelance" | "hire" | "both";
  preferredView: Role;
  theme: ThemeChoice;
  onboarded: boolean;
};

type MoneyInput = {
  kind: LedgerKind;
  agreementId: string;
  milestoneId: string;
  proposalId?: string;
  title: string;
};

export type DemoApi = {
  mode: "preview" | "live";
  sessionWallet: string | null;
  impersonate: boolean;
  actingRole: (agreement: Agreement) => Role;
  profile: Profile | null;
  walletMessage: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  setTheme: (theme: ThemeChoice) => void;
  saveProfile: (patch: Partial<Profile> & { onboarded?: boolean }) => Promise<void>;
  downloadReceipt: (entryId: string) => Promise<void>;
  faucet: () => Promise<void>;
  reviseAgreement: (id: string) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  state: DemoState;
  previewLoading: boolean;
  setPreviewLoading: (value: boolean) => void;
  notice: Notice | null;
  dismissNotice: () => void;
  tx: TxView | null;
  dismissTx: () => void;
  setRole: (role: Role) => void;
  setWalletPreview: (preview: WalletPreview) => void;
  setNextOutcome: (outcome: TxOutcome) => void;
  resetDemo: () => void;
  saveAgreement: (
    existingId: string | null,
    form: AgreementInput,
    mode: "draft" | "share" | "invite",
  ) => Promise<{ ok: true; id: string; path?: string } | { ok: false; error: string; errors?: FieldErrors }>;
  confirmClient: (id: string) => Promise<{ ok: boolean; error?: string }>;
  declineClient: (id: string) => Promise<{ ok: boolean; error?: string }>;
  switchWallet: (wallet: string) => Promise<void>;
  deleteDraft: (id: string) => Promise<{ ok: boolean; error?: string }>;
  acceptAgreement: (id: string, termsRef: string) => Promise<{ ok: boolean; error?: string }>;
  submitWork: (input: { agreementId: string; milestoneId: string; note: string; links: Array<{ label: string; url: string }> }) => Promise<{ ok: boolean; error?: string }>;
  requestChanges: (input: { agreementId: string; milestoneId: string; reason: string }) => Promise<{ ok: boolean; error?: string }>;
  proposeCancellation: (input: { agreementId: string; milestoneId: string; note: string }) => Promise<{ ok: boolean; error?: string }>;
  replaceCancellation: (input: { agreementId: string; milestoneId: string; proposalId: string; note: string }) => Promise<{ ok: boolean; error?: string }>;
  declineCancellation: (input: { agreementId: string; milestoneId: string; proposalId: string }) => Promise<{ ok: boolean; error?: string }>;
  runMoney: (input: MoneyInput) => Promise<void>;
};

export const DemoContext = createContext<DemoApi | null>(null);

export function DemoProvider({ children, repository = browserDemoRepository }: { children: ReactNode; repository?: DemoRepository }) {
  const [state, setState] = useState<DemoState>(() => repository.load());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tx, setTx] = useState<TxView | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const ready = useRef(false);

  useEffect(() => {
    if (!ready.current) {
      ready.current = true;
      return;
    }
    repository.save(state);
  }, [repository, state]);

  const api = useMemo<DemoApi>(() => {
    const commit = (next: DemoState) => {
      stateRef.current = next;
      setState(next);
    };

    return {
      mode: "preview",
      sessionWallet: null,
      impersonate: true,
      actingRole: () => stateRef.current.role,
      profile: null,
      walletMessage: null,
      signIn: async () => undefined,
      signOut: async () => undefined,
      setTheme: () => undefined,
      saveProfile: async () => undefined,
      downloadReceipt: async () => {
        try {
          const { downloadReceiptFile } = await import("../live/api");
          await downloadReceiptFile("sample");
        } catch (error) {
          setNotice({ tone: "danger", title: "The simulated receipt did not download.", detail: error instanceof Error ? error.message : "Try again." });
        }
      },
      faucet: async () => undefined,
      reviseAgreement: async () => ({ ok: false, error: "Sample agreements stay in this browser." }),
      state,
      previewLoading,
      setPreviewLoading,
      notice,
      dismissNotice: () => setNotice(null),
      tx,
      dismissTx: () => setTx(null),
      setRole: (role) => commit({ ...stateRef.current, role }),
      setWalletPreview: (walletPreview) => commit({ ...stateRef.current, walletPreview }),
      setNextOutcome: (nextOutcome) => commit({ ...stateRef.current, nextOutcome }),
      resetDemo: () => {
        const next = repository.reset();
        commit(next);
        setPreviewLoading(false);
        setTx(null);
        setNotice({ tone: "ok", title: "Demo data reset." });
      },
      confirmClient: async () => ({ ok: false, error: "Sample mode does not confirm a client wallet." }),
      declineClient: async () => ({ ok: false, error: "Sample mode does not confirm a client wallet." }),
      switchWallet: async () => undefined,
      saveAgreement: async (existingId, form, mode) => {
        if (mode === "invite") return { ok: false, error: "Invitation links are for a signed-in workspace. Sample mode stays in this browser." };
        const drafted = upsertDraft(stateRef.current, existingId, form, AMARA);
        if (!drafted.ok || !drafted.id) return { ok: false, error: drafted.ok ? "Could not save the draft." : drafted.error };
        if (mode === "draft") {
          commit(drafted.state);
          setNotice({ tone: "ok", title: "Draft saved in this browser." });
          return { ok: true, id: drafted.id };
        }
        const shared = shareDraft(drafted.state, drafted.id, AMARA.wallet);
        if (!shared.ok) return { ok: false, error: shared.error, errors: shared.errors };
        commit(shared.state);
        setNotice({ tone: "ok", title: "Agreement shared. The client can accept it from their view." });
        return { ok: true, id: drafted.id };
      },
      deleteDraft: async (id) => {
        const result = deleteDraft(stateRef.current, id);
        if (!result.ok) return { ok: false, error: result.error };
        commit(result.state);
        return { ok: true };
      },
      acceptAgreement: async (id, termsRef) => {
        const result = acceptAgreement(stateRef.current, id, stateRef.current.role, termsRef);
        if (!result.ok) return { ok: false, error: result.error };
        commit(result.state);
        setNotice({ tone: "ok", title: "Terms accepted. Milestones are still unfunded until you fund them." });
        return { ok: true };
      },
      submitWork: async (input) => {
        const result = submitWork(stateRef.current, { ...input, role: stateRef.current.role });
        if (!result.ok) return { ok: false, error: result.error };
        commit(result.state);
        setNotice({ tone: "ok", title: "Work submitted. Payment stays held until the client approves it." });
        return { ok: true };
      },
      requestChanges: async (input) => {
        const result = requestChanges(stateRef.current, { ...input, role: stateRef.current.role });
        if (!result.ok) return { ok: false, error: result.error };
        commit(result.state);
        setNotice({ tone: "ok", title: "Changes requested. The funds stay held." });
        return { ok: true };
      },
      proposeCancellation: async (input) => {
        const result = proposeCancellation(stateRef.current, { ...input, role: stateRef.current.role });
        if (!result.ok) return { ok: false, error: result.error };
        commit(result.state);
        setNotice({ tone: "ok", title: "Cancellation proposed. Funds stay held until the other person agrees." });
        return { ok: true };
      },
      replaceCancellation: async (input) => {
        const result = replaceCancellation(stateRef.current, { ...input, role: stateRef.current.role });
        if (!result.ok) return { ok: false, error: result.error };
        commit(result.state);
        setNotice({ tone: "ok", title: "Proposal updated. The previous version can no longer be approved." });
        return { ok: true };
      },
      declineCancellation: async (input) => {
        const result = declineCancellation(stateRef.current, { ...input, role: stateRef.current.role });
        if (!result.ok) return { ok: false, error: result.error };
        commit(result.state);
        setNotice({ tone: "ok", title: "Proposal closed. The milestone returns to its previous step and the funds stay held." });
        return { ok: true };
      },
      runMoney: async (input) => {
        const current = stateRef.current;
        const blocked = moneyBlockReason(current.walletPreview);
        if (blocked) {
          setNotice({ tone: "danger", title: blocked });
          return;
        }
        setTx({ phase: "pending", kind: input.kind, agreementId: input.agreementId, milestoneId: input.milestoneId, title: input.title });
        await wait(prefersReducedMotion() ? 0 : 700);
        const latest = stateRef.current;
        if (latest.nextOutcome !== "success") {
          const recorded = recordAttempt(latest, {
            agreementId: input.agreementId,
            milestoneId: input.milestoneId,
            kind: input.kind,
            result: latest.nextOutcome === "rejected" ? "rejected" : "failed",
          });
          if (recorded.ok) commit(recorded.state);
          setTx({
            phase: latest.nextOutcome,
            kind: input.kind,
            agreementId: input.agreementId,
            milestoneId: input.milestoneId,
            entryId: recorded.ok ? recorded.entryId : undefined,
            title: input.title,
          });
          return;
        }
        const clock = { now: nowIso() };
        const applied =
          input.kind === "fund"
            ? fundMilestone(latest, input.agreementId, input.milestoneId, latest.role, clock)
            : input.kind === "release"
              ? releasePayment(latest, input.agreementId, input.milestoneId, latest.role, clock)
              : approveCancellation(latest, {
                  agreementId: input.agreementId,
                  milestoneId: input.milestoneId,
                  role: latest.role,
                  proposalId: input.proposalId ?? "",
                }, clock);
        if (!applied.ok) {
          setTx(null);
          setNotice({ tone: "danger", title: applied.error });
          return;
        }
        commit(applied.state);
        setTx({
          phase: "success",
          kind: input.kind,
          agreementId: input.agreementId,
          milestoneId: input.milestoneId,
          entryId: applied.entryId,
          title: input.title,
        });
      },
    };
  }, [notice, previewLoading, repository, state, tx]);

  return <DemoContext.Provider value={api}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoApi {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}
