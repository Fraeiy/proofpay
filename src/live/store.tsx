import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAddress, type Address, type Hash } from "viem";
import { createPublicClient, http } from "viem";
import { escrowAbi, tokenAbi } from "../../shared/protocol.mjs";
import { connectAccount, currentAccount, currentChainId, ensureChain, ethereum, rejectedByWallet, sendContract, signLogin, walletChain, type ChainConfig } from "../chain/wallet";
import { DemoContext, type DemoApi, type Profile, type TxPhase, type TxView } from "../demo/store";
import type { Agreement, AgreementInput, DemoState, LedgerKind, Role } from "../domain/types";
import { api, ApiError, downloadReceiptFile } from "./api";
import { persistTheme, type ThemeChoice } from "../theme";

type Workspace = {
  user: Profile;
  agreements: Agreement[];
  ledger: DemoState["ledger"];
  chainSync: string;
};

const emptyState: DemoState = {
  version: 1,
  role: "freelancer",
  walletPreview: "disconnected",
  nextOutcome: "success",
  agreements: [],
  ledger: [],
};

function txPhase(status: string): TxPhase {
  if (status === "confirmed") return "success";
  if (status === "reverted") return "failed";
  if (status === "pending" || status === "submitted") return "pending";
  if (status === "rejected") return "rejected";
  return "unknown";
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<DemoState>(emptyState);
  const [config, setConfig] = useState<ChainConfig | null>(null);
  const [chainSync, setChainSync] = useState("unconfigured");
  const [notice, setNotice] = useState<DemoApi["notice"]>(null);
  const [tx, setTx] = useState<TxView | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [connected, setConnected] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const stateRef = useRef(state);
  stateRef.current = state;

  const refresh = useCallback(async () => {
    const workspace = await api<Workspace>("/api/workspace");
    setProfile(workspace.user);
    setChainSync(workspace.chainSync);
    setState((current) => ({
      ...current,
      role: workspace.user.preferredView,
      agreements: workspace.agreements,
      ledger: workspace.ledger,
    }));
    if (workspace.chainSync === "unavailable") {
      setNotice({ tone: "danger", title: "The network could not be checked. Shown balances may be a moment behind. Nothing was marked paid or failed because of that." });
    }
    return workspace;
  }, []);

  useEffect(() => {
    let gone = false;
    void (async () => {
      try {
        const [session, nextConfig, account, activeChain] = await Promise.all([
          api<{ user: Profile | null; expired?: boolean }>("/api/auth/session"),
          api<ChainConfig>("/api/config"),
          currentAccount().catch(() => null),
          currentChainId().catch(() => null),
        ]);
        if (gone) return;
        setConfig(nextConfig);
        setConnected(account);
        setChainId(activeChain);
        if (session.expired) setNotice({ tone: "danger", title: "Your session expired. Sign in again." });
        if (session.user) {
          persistTheme(session.user.theme);
          await refresh();
        }
      } catch (error) {
        if (!gone) setNotice({ tone: "danger", title: error instanceof Error ? error.message : "ProofPay could not reach the server." });
      } finally {
        if (!gone) setPreviewLoading(false);
      }
    })();
    return () => { gone = true; };
  }, [refresh]);

  useEffect(() => {
    const provider = ethereum();
    if (!provider?.on) return;
    const onAccounts = (accounts: unknown) => {
      const next = Array.isArray(accounts) && typeof accounts[0] === "string" ? getAddress(accounts[0]) : null;
      setConnected(next);
      const signedIn = profileRef.current?.wallet;
      if (signedIn && next && next.toLowerCase() !== signedIn.toLowerCase()) {
        void api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
        setProfile(null);
        setState(emptyState);
        setNotice({ tone: "danger", title: "The connected wallet changed. Sign in again. The previous session was closed." });
      }
      if (signedIn && !next) {
        void api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
        setProfile(null);
        setState(emptyState);
      }
    };
    const onChain = (hex: unknown) => setChainId(typeof hex === "string" ? Number(hex) : null);
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const walletMessage = useMemo(() => {
    if (!profile) return "Sign in with your wallet. Connecting a wallet does not sign you in by itself.";
    if (!connected) return "The wallet is not connected. Sign in again before funding or payment.";
    if (connected.toLowerCase() !== profile.wallet.toLowerCase()) return "This wallet is not the signed-in account. Sign in again.";
    if (!config?.configured) return "The escrow contract is not configured on this server yet. You can still prepare an agreement, but funding stays closed.";
    if (chainId !== config.chainId) return `Switch your wallet to ${config.chainName} (chain ${config.chainId}) before a payment. No funds moved.`;
    return null;
  }, [chainId, config, connected, profile]);

  useEffect(() => {
    setState((current) => ({
      ...current,
      walletPreview: walletMessage?.includes("chain") ? "wrong_network" : walletMessage ? "disconnected" : "demo",
    }));
  }, [walletMessage]);

  async function report(hash: Hash | null, body: Record<string, unknown>, view: Omit<TxView, "phase">) {
    if (!hash) return;
    setTx({ ...view, phase: "submitted" });
    let result = await api<{ status: string; detail?: string }>("/api/tx", { method: "POST", body: JSON.stringify({ ...body, txHash: hash }) });
    for (let attempt = 0; attempt < 8 && result.status === "pending"; attempt += 1) {
      setTx({ ...view, phase: "pending" });
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      result = await api("/api/tx", { method: "POST", body: JSON.stringify({ ...body, txHash: hash }) });
    }
    const workspace = await refresh().catch(() => null);
    const entry = workspace?.ledger.find((item) => item.txHash?.toLowerCase() === hash.toLowerCase());
    setTx({ ...view, phase: txPhase(result.status), entryId: entry?.id });
    if (result.status === "unknown") setNotice({ tone: "danger", title: result.detail || "The transaction could not be verified yet. It was not marked failed." });
  }

  async function failWallet(error: unknown, body: Record<string, unknown>, view: Omit<TxView, "phase">) {
    const status = rejectedByWallet(error) ? "rejected" : "unknown";
    await api("/api/tx", { method: "POST", body: JSON.stringify({ ...body, status, detail: error instanceof Error ? error.message : "" }) }).catch(() => undefined);
    if (status === "rejected" && body.submissionId) {
      await api(`/api/submissions/${String(body.submissionId)}/abandon`, { method: "POST", body: "{}" }).catch(() => undefined);
    }
    setTx({ ...view, phase: status === "rejected" ? "rejected" : "unknown" });
    await refresh().catch(() => undefined);
  }

  const apiValue = useMemo<DemoApi>(() => {
    const actingRole = (agreement: Agreement): Role => {
      const wallet = profile?.wallet.toLowerCase();
      return wallet && agreement.freelancer.wallet.toLowerCase() === wallet ? "freelancer" : "client";
    };

    return {
      mode: "live",
      sessionWallet: profile?.wallet ?? null,
      impersonate: false,
      actingRole,
      profile,
      walletMessage,
      previewLoading,
      setPreviewLoading,
      notice,
      dismissNotice: () => setNotice(null),
      tx,
      dismissTx: () => setTx(null),
      state: { ...state, role: profile?.preferredView ?? state.role },
      signIn: async () => {
        if (!config) throw new Error("Network configuration is still loading.");
        const account = await connectAccount();
        await ensureChain(config);
        setConnected(account);
        setChainId(config.chainId);
        const challenge = await api<{ message: string }>("/api/auth/challenge", {
          method: "POST",
          body: JSON.stringify({ address: account, chainId: config.chainId }),
        });
        const signature = await signLogin(account, challenge.message);
        const verified = await api<{ user: Profile }>("/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({ message: challenge.message, signature }),
        });
        persistTheme(verified.user.theme);
        setProfile(verified.user);
        await refresh();
      },
      signOut: async () => {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
        setProfile(null);
        setState(emptyState);
        setNotice({ tone: "ok", title: "Signed out." });
      },
      setTheme: (theme: ThemeChoice) => {
        persistTheme(theme);
        if (profileRef.current) void api("/api/me", { method: "PATCH", body: JSON.stringify({ theme }) }).then(() => setProfile((current) => current ? { ...current, theme } : current));
      },
      saveProfile: async (patch) => {
        const saved = await api<{ user: Profile }>("/api/me", { method: "PATCH", body: JSON.stringify(patch) });
        setProfile(saved.user);
        setState((current) => ({ ...current, role: saved.user.preferredView }));
        if (patch.theme) persistTheme(patch.theme);
      },
      downloadReceipt: async (entryId) => {
        await downloadReceiptFile(entryId);
      },
      faucet: async () => {
        if (!config?.token || !profile) {
          setNotice({ tone: "danger", title: "The test token is not configured yet." });
          return;
        }
        await ensureChain(config);
        setTx({ phase: "awaiting", kind: "fund", agreementId: "", milestoneId: "", title: "Get test tUSDC" });
        try {
          const hash = await sendContract(config, {
            account: getAddress(profile.wallet),
            address: config.token,
            abi: tokenAbi,
            functionName: "faucet",
            args: [],
          });
          setTx({ phase: "pending", kind: "fund", agreementId: "", milestoneId: "", title: "Get test tUSDC" });
          if (config.rpcUrl) {
            const reader = createPublicClient({ chain: walletChain(config), transport: http(config.rpcUrl) });
            await reader.waitForTransactionReceipt({ hash });
          }
          setTx({ phase: "success", kind: "fund", agreementId: "", milestoneId: "", title: "Test tUSDC received" });
          setNotice({ tone: "ok", title: "Test tUSDC was added to this wallet. It has no monetary value." });
        } catch (error) {
          setTx({ phase: rejectedByWallet(error) ? "rejected" : "unknown", kind: "fund", agreementId: "", milestoneId: "", title: "Get test tUSDC" });
        }
      },
      reviseAgreement: async (id) => {
        try {
          const saved = await api<{ agreement: Agreement }>(`/api/agreements/${id}/revise`, { method: "POST", body: "{}" });
          await refresh();
          return { ok: true, id: saved.agreement.id };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Could not start a new version." };
        }
      },
      setRole: (role) => {
        setState((current) => ({ ...current, role }));
        setProfile((current) => current ? { ...current, preferredView: role } : current);
        if (profileRef.current) void api("/api/me", { method: "PATCH", body: JSON.stringify({ preferredView: role }) }).catch(() => undefined);
      },
      setWalletPreview: () => undefined,
      setNextOutcome: () => undefined,
      resetDemo: () => undefined,
      saveAgreement: async (existingId, form: AgreementInput, mode) => {
        try {
          const saved = await api<{ agreement: Agreement }>(existingId ? `/api/agreements/${existingId}` : "/api/agreements", {
            method: existingId ? "PATCH" : "POST",
            body: JSON.stringify(form),
          });
          if (mode === "draft") {
            await refresh();
            setNotice({ tone: "ok", title: "Draft saved." });
            return { ok: true, id: saved.agreement.id };
          }
          const commit = await api<{ escrow: Address; client: Address; termsHash: Hash; amounts: string[] }>(`/api/agreements/${saved.agreement.id}/commit`, { method: "POST", body: "{}" });
          if (!config || !profile) return { ok: false, error: "Sign in before sharing." };
          const view = { kind: "fund" as LedgerKind, agreementId: saved.agreement.id, milestoneId: "", title: "Commit agreement terms" };
          setTx({ ...view, phase: "awaiting" });
          try {
            await ensureChain(config);
            const hash = await sendContract(config, {
              account: getAddress(profile.wallet),
              address: commit.escrow,
              abi: escrowAbi,
              functionName: "createAgreement",
              args: [commit.client, commit.termsHash, commit.amounts.map((amount) => BigInt(amount))],
            });
            await report(hash, { purpose: "create", agreementId: saved.agreement.id }, view);
          } catch (error) {
            await failWallet(error, { purpose: "create", agreementId: saved.agreement.id }, view);
            return { ok: false, error: rejectedByWallet(error) ? "You rejected the wallet request. The draft is still saved." : "The agreement was not committed. The draft is still saved." };
          }
          setNotice({ tone: "ok", title: "Terms committed. The client can accept this version." });
          return { ok: true, id: saved.agreement.id };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Could not save the agreement." };
        }
      },
      deleteDraft: async (id) => {
        try {
          await api(`/api/agreements/${id}`, { method: "DELETE" });
          await refresh();
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Could not delete the draft." };
        }
      },
      acceptAgreement: async (id) => {
        const agreement = stateRef.current.agreements.find((item) => item.id === id);
        const view = { kind: "fund" as LedgerKind, agreementId: id, milestoneId: "", title: "Accept agreement" };
        try {
          const prepared = await api<{ escrow: Address; chainAgreementId: string; termsHash: Hash }>(`/api/agreements/${id}/accept`, { method: "POST", body: "{}" });
          if (!config || !profile) return { ok: false, error: "Sign in as the client to accept." };
          setTx({ ...view, phase: "awaiting" });
          const hash = await sendContract(config, {
            account: getAddress(profile.wallet),
            address: prepared.escrow,
            abi: escrowAbi,
            functionName: "accept",
            args: [BigInt(prepared.chainAgreementId), prepared.termsHash],
          });
          await report(hash, { purpose: "accept", agreementId: id }, view);
          setNotice({ tone: "ok", title: "Terms accepted. Milestones stay unfunded until you fund them." });
          return { ok: true };
        } catch (error) {
          if (error instanceof ApiError) return { ok: false, error: error.message };
          await failWallet(error, { purpose: "accept", agreementId: id }, view);
          return { ok: false, error: rejectedByWallet(error) ? "You rejected the wallet request. The terms were not accepted." : "Acceptance could not be verified yet." };
        }
        void agreement;
      },
      submitWork: async (input) => {
        const agreement = stateRef.current.agreements.find((item) => item.id === input.agreementId);
        const milestone = agreement?.milestones.find((item) => item.id === input.milestoneId);
        const view = { kind: "fund" as LedgerKind, agreementId: input.agreementId, milestoneId: input.milestoneId, title: "Submit work" };
        let submissionId = "";
        try {
          const prepared = await api<{ submissionId: string; ref: Hash; escrow: Address; chainAgreementId: string; index: number }>(`/api/milestones/${input.milestoneId}/submission`, {
            method: "POST",
            body: JSON.stringify({ note: input.note, links: input.links }),
          });
          submissionId = prepared.submissionId;
          if (!config || !profile || !prepared.chainAgreementId) return { ok: false, error: "This agreement is not on the escrow contract yet." };
          setTx({ ...view, phase: "awaiting" });
          const hash = await sendContract(config, {
            account: getAddress(profile.wallet),
            address: prepared.escrow,
            abi: escrowAbi,
            functionName: "submit",
            args: [BigInt(prepared.chainAgreementId), BigInt(prepared.index), prepared.ref],
          });
          await report(hash, { purpose: "submit", agreementId: input.agreementId, milestoneId: input.milestoneId, submissionId }, view);
          setNotice({ tone: "ok", title: "Work submitted. Payment stays held until the client approves it." });
          return { ok: true };
        } catch (error) {
          if (submissionId) await failWallet(error, { purpose: "submit", agreementId: input.agreementId, milestoneId: input.milestoneId, submissionId }, view);
          return { ok: false, error: error instanceof Error ? error.message : "The submission was not recorded." };
        }
        void milestone;
      },
      requestChanges: async (input) => {
        const view = { kind: "fund" as LedgerKind, agreementId: input.agreementId, milestoneId: input.milestoneId, title: "Request changes" };
        try {
          const prepared = await api<{ escrow: Address; chainAgreementId: string; index: number; revisionId: string }>(`/api/milestones/${input.milestoneId}/changes`, {
            method: "POST",
            body: JSON.stringify({ reason: input.reason }),
          });
          if (!config || !profile) return { ok: false, error: "Sign in as the client to request changes." };
          setTx({ ...view, phase: "awaiting" });
          const hash = await sendContract(config, {
            account: getAddress(profile.wallet),
            address: prepared.escrow,
            abi: escrowAbi,
            functionName: "requestChanges",
            args: [BigInt(prepared.chainAgreementId), BigInt(prepared.index)],
          });
          await report(hash, { purpose: "changes", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
          setNotice({ tone: "ok", title: "Changes requested. The funds stay held." });
          return { ok: true };
        } catch (error) {
          if (!(error instanceof ApiError)) await failWallet(error, { purpose: "changes", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
          return { ok: false, error: error instanceof Error ? error.message : "The request was not recorded." };
        }
      },
      proposeCancellation: async (input) => sendCancel(input, "Cancellation proposed. Funds stay held until the other person agrees."),
      replaceCancellation: async (input) => sendCancel(input, "Proposal updated. An approval of the previous version can no longer refund the milestone."),
      declineCancellation: async (input) => {
        const agreement = stateRef.current.agreements.find((item) => item.id === input.agreementId);
        const milestone = agreement?.milestones.find((item) => item.id === input.milestoneId);
        const view = { kind: "refund" as LedgerKind, agreementId: input.agreementId, milestoneId: input.milestoneId, title: "Withdraw cancellation" };
        try {
          if (!config?.escrow || !profile || !agreement?.chainAgreementId || !milestone) return { ok: false, error: "This milestone is not on the escrow contract." };
          const index = agreement.milestones.findIndex((item) => item.id === milestone.id);
          setTx({ ...view, phase: "awaiting" });
          const hash = await sendContract(config, {
            account: getAddress(profile.wallet),
            address: config.escrow,
            abi: escrowAbi,
            functionName: "withdrawCancel",
            args: [BigInt(agreement.chainAgreementId), BigInt(index)],
          });
          await report(hash, { purpose: "withdraw", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
          setNotice({ tone: "ok", title: "Proposal withdrawn. The funds stay held." });
          return { ok: true };
        } catch (error) {
          await failWallet(error, { purpose: "withdraw", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
          return { ok: false, error: error instanceof Error ? error.message : "The proposal was not withdrawn." };
        }
      },
      runMoney: async (input) => {
        const agreement = stateRef.current.agreements.find((item) => item.id === input.agreementId);
        const milestone = agreement?.milestones.find((item) => item.id === input.milestoneId);
        const index = agreement?.milestones.findIndex((item) => item.id === input.milestoneId) ?? -1;
        const view = { kind: input.kind, agreementId: input.agreementId, milestoneId: input.milestoneId, title: input.title };
        if (!config?.escrow || !config.token || !profile || !agreement?.chainAgreementId || !milestone || index < 0) {
          setNotice({ tone: "danger", title: walletMessage || "This milestone is not ready on the escrow contract." });
          return;
        }
        if (walletMessage) {
          setNotice({ tone: "danger", title: walletMessage });
          return;
        }
        try {
          await ensureChain(config);
          const account = getAddress(profile.wallet);
          if (input.kind === "fund") {
            const reader = createPublicClient({ chain: walletChain(config), transport: http(config.rpcUrl) });
            const needed = BigInt(milestone.amount) * 10_000n;
            const allowance = await reader.readContract({ address: config.token, abi: tokenAbi, functionName: "allowance", args: [account, config.escrow] });
            if (allowance < needed) {
              setTx({ ...view, phase: "awaiting", title: "Allow the exact tUSDC amount" });
              const approval = await sendContract(config, { account, address: config.token, abi: tokenAbi, functionName: "approve", args: [config.escrow, needed] });
              setTx({ ...view, phase: "pending", title: "Confirming token allowance" });
              await reader.waitForTransactionReceipt({ hash: approval });
            }
            setTx({ ...view, phase: "awaiting", title: "Deposit into escrow" });
            const hash = await sendContract(config, { account, address: config.escrow, abi: escrowAbi, functionName: "fund", args: [BigInt(agreement.chainAgreementId), BigInt(index)] });
            await report(hash, { purpose: "fund", agreementId: input.agreementId, milestoneId: input.milestoneId }, { ...view, title: "Deposit into escrow" });
            return;
          }
          if (input.kind === "release") {
            setTx({ ...view, phase: "awaiting" });
            const hash = await sendContract(config, { account, address: config.escrow, abi: escrowAbi, functionName: "release", args: [BigInt(agreement.chainAgreementId), BigInt(index)] });
            await report(hash, { purpose: "release", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
            return;
          }
          setTx({ ...view, phase: "awaiting" });
          const hash = await sendContract(config, {
            account,
            address: config.escrow,
            abi: escrowAbi,
            functionName: "approveCancel",
            args: [BigInt(agreement.chainAgreementId), BigInt(index), BigInt(input.proposalId || milestone.cancellation?.id || "0")],
          });
          await report(hash, { purpose: "refund", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
        } catch (error) {
          await failWallet(error, { purpose: input.kind, agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
        }
      },
    };

    async function sendCancel(input: { agreementId: string; milestoneId: string; note: string }, success: string) {
      const agreement = stateRef.current.agreements.find((item) => item.id === input.agreementId);
      const index = agreement?.milestones.findIndex((item) => item.id === input.milestoneId) ?? -1;
      const view = { kind: "refund" as LedgerKind, agreementId: input.agreementId, milestoneId: input.milestoneId, title: "Propose cancellation" };
      try {
        const prepared = await api<{ escrow: Address; chainAgreementId: string; index: number }>(`/api/milestones/${input.milestoneId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ note: input.note }),
        });
        if (!config || !profile) return { ok: false as const, error: "Sign in to propose cancellation." };
        setTx({ ...view, phase: "awaiting" });
        const hash = await sendContract(config, {
          account: getAddress(profile.wallet),
          address: prepared.escrow,
          abi: escrowAbi,
          functionName: "proposeCancel",
          args: [BigInt(prepared.chainAgreementId), BigInt(prepared.index)],
        });
        await report(hash, { purpose: "propose", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
        setNotice({ tone: "ok", title: success });
        return { ok: true as const };
      } catch (error) {
        if (!(error instanceof ApiError)) await failWallet(error, { purpose: "propose", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
        return { ok: false as const, error: error instanceof Error ? error.message : "The proposal was not recorded." };
      }
      void index;
    }
  }, [config, notice, previewLoading, profile, refresh, state, tx, walletMessage]);

  return <DemoContext.Provider value={apiValue}>{children}</DemoContext.Provider>;
}
