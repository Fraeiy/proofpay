import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAddress, type Address, type Hash } from "viem";
import { createPublicClient, http } from "viem";
import { escrowAbi, tokenAbi } from "../../shared/protocol.mjs";
import { useAuth } from "../auth/PrivyGate";
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
  attempts?: Array<{
    txHash: Hash;
    purpose: string;
    agreementId: string | null;
    milestoneId: string | null;
    status: string;
    detail: string | null;
  }>;
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

type PendingRecord = {
  hash: Hash;
  purpose: string;
  agreementId: string;
  milestoneId: string;
  submissionId?: string;
  title: string;
  kind: LedgerKind;
  startedAt: number;
};

const PENDING_TX = "proofpay.pendingTx";
const PENDING_APPROVAL = "proofpay.pendingApproval";

function readPending(): PendingRecord | null {
  try {
    const raw = sessionStorage.getItem(PENDING_TX);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRecord;
    if (!/^0x[a-fA-F0-9]{64}$/.test(parsed.hash ?? "")) return null;
    if (!parsed.startedAt) parsed.startedAt = Date.now();
    return parsed;
  } catch {
    return null;
  }
}

function rememberPending(record: Omit<PendingRecord, "startedAt"> & { startedAt?: number }) {
  const current = readPending();
  const startedAt = current && current.hash.toLowerCase() === record.hash.toLowerCase()
    ? current.startedAt
    : record.startedAt ?? Date.now();
  sessionStorage.setItem(PENDING_TX, JSON.stringify({ ...record, startedAt }));
}

function hashFromError(error: unknown): Hash | null {
  if (typeof error === "object" && error && "hash" in error) {
    const hash = String((error as { hash: unknown }).hash ?? "");
    if (/^0x[a-fA-F0-9]{64}$/.test(hash)) return hash as Hash;
  }
  return null;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const sessionKind = useRef<"siwe" | "privy" | null>(null);
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
  const moneyBusy = useRef(false);
  const resumed = useRef(false);

  const refresh = useCallback(async () => {
    const workspace = await api<Workspace>("/api/workspace");
    if (!readPending() && workspace.attempts?.[0]) {
      const open = workspace.attempts[0];
      const purpose = open.purpose;
      rememberPending({
        hash: open.txHash,
        purpose,
        agreementId: open.agreementId ?? "",
        milestoneId: open.milestoneId ?? "",
        title: "Checking a submitted transaction",
        kind: purpose === "release" ? "release" : purpose === "refund" ? "refund" : "fund",
      });
    }
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
      if (sessionKind.current !== "siwe") return;
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
    if (!profile) return auth.configured ? "Sign in with Google, email, or an existing wallet. Sign-in does not move funds." : "Sign in with your wallet. Connecting a wallet does not sign you in by itself.";
    if (auth.configured && auth.authenticated && !auth.walletReady) return auth.error || "The wallet is still being prepared. Payment actions stay closed until it is ready.";
    if (!connected) return "The wallet is not connected. Sign in again before funding or payment.";
    if (connected.toLowerCase() !== profile.wallet.toLowerCase()) return "The connected wallet is not the active signer. Switch to the wallet named on this agreement before a payment.";
    if (!config?.configured) return "The escrow contract is not configured on this server yet. You can still prepare an agreement, but funding stays closed.";
    if (chainId !== config.chainId) return `Switch your wallet to ${config.chainName} (chain ${config.chainId}) before a payment. No funds moved.`;
    return null;
  }, [auth.authenticated, auth.configured, auth.error, auth.walletReady, chainId, config, connected, profile]);

  useEffect(() => {
    setState((current) => ({
      ...current,
      walletPreview: walletMessage?.includes("chain") ? "wrong_network" : walletMessage ? "disconnected" : "demo",
    }));
  }, [walletMessage]);

  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(() => {
    const current = authRef.current;
    if (!current.configured || !current.authenticated || !current.walletReady || !current.signerAddress) return;
    let gone = false;
    sessionKind.current = "privy";
    setConnected(getAddress(current.signerAddress));
    void currentChainId().then((id) => { if (!gone && id) setChainId(id); }).catch(() => undefined);
    void (async () => {
      try {
        const token = await current.getAccessToken();
        if (!token || gone) return;
        const saved = await api<{ pendingWallet?: boolean; user: Profile | null }>("/api/auth/privy", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ activeWallet: current.signerAddress }),
        });
        if (gone) return;
        if (saved.pendingWallet || !saved.user) {
          setNotice({ tone: "danger", title: "The wallet is not ready yet. Retry wallet setup. A second wallet is not created." });
          return;
        }
        persistTheme(saved.user.theme);
        setProfile(saved.user);
        setState((current) => ({ ...current, role: saved.user?.preferredView ?? current.role }));
        await refresh();
        const next = sessionStorage.getItem("proofpay.next");
        const stored = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
        if (stored) sessionStorage.removeItem("proofpay.next");
        const destination = stored || (window.location.pathname === "/" ? "/overview" : "");
        if (destination && window.location.pathname !== destination) window.location.assign(destination);
      } catch (error) {
        if (!gone) setNotice({ tone: "danger", title: error instanceof Error ? error.message : "Sign-in did not finish." });
      }
    })();
    return () => { gone = true; };
  }, [auth.authenticated, auth.configured, auth.linkedCount, auth.signerAddress, auth.walletReady, refresh]);

  async function report(hash: Hash | null, body: Record<string, unknown>, view: Omit<TxView, "phase">) {
    if (!hash) return { status: "unknown", settled: false, detail: "No transaction hash was returned." };
    rememberPending({
      hash,
      purpose: String(body.purpose ?? ""),
      agreementId: view.agreementId,
      milestoneId: view.milestoneId,
      submissionId: typeof body.submissionId === "string" ? body.submissionId : undefined,
      title: view.title,
      kind: view.kind,
    });
    setTx({ ...view, phase: "submitted" });
    let result: { status: string; detail?: string; settled?: boolean } = { status: "unknown", settled: false };
    try {
      result = await api("/api/tx", { method: "POST", body: JSON.stringify({ ...body, txHash: hash }) });
      for (let attempt = 0; attempt < 8 && result.status === "pending"; attempt += 1) {
        setTx({ ...view, phase: "pending" });
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        result = await api("/api/tx", { method: "POST", body: JSON.stringify({ ...body, txHash: hash }) });
      }
    } catch (error) {
      result = { status: "unknown", settled: false, detail: error instanceof Error ? error.message : "The network did not answer." };
    }
    if (result.settled || result.status === "confirmed" || result.status === "reverted" || result.status === "unmatched") {
      const current = readPending();
      if (current?.hash.toLowerCase() === hash.toLowerCase()) sessionStorage.removeItem(PENDING_TX);
    }
    const workspace = await refresh().catch(() => null);
    const entry = workspace?.ledger.find((item) => item.txHash?.toLowerCase() === hash.toLowerCase());
    setTx({ ...view, phase: txPhase(result.status), entryId: entry?.id });
    if (result.status === "unknown" || result.status === "unmatched") {
      setNotice({ tone: "danger", title: result.detail || "The transaction could not be verified yet. It was not sent again." });
    }
    return result;
  }

  async function failWallet(error: unknown, body: Record<string, unknown>, view: Omit<TxView, "phase">) {
    const leaked = hashFromError(error);
    if (leaked) {
      await report(leaked, body, view);
      return;
    }
    const status = rejectedByWallet(error) ? "rejected" : "unknown";
    await api("/api/tx", { method: "POST", body: JSON.stringify({ ...body, status, detail: error instanceof Error ? error.message : "" }) }).catch(() => undefined);
    if (status === "rejected" && body.submissionId) {
      await api(`/api/submissions/${String(body.submissionId)}/abandon`, { method: "POST", body: "{}" }).catch(() => undefined);
    }
    setTx({ ...view, phase: status === "rejected" ? "rejected" : "unknown" });
    if (status === "unknown") {
      setNotice({ tone: "danger", title: "The wallet request did not finish. If your wallet still shows it as pending, wait for that transaction. It was not sent again." });
    }
    await refresh().catch(() => undefined);
  }

  function samePending(purpose: string, agreementId: string, milestoneId: string) {
    const pending = readPending();
    if (!pending || pending.purpose !== purpose || pending.agreementId !== agreementId || pending.milestoneId !== milestoneId) return null;
    if (Date.now() - pending.startedAt > 3 * 60 * 1000) {
      sessionStorage.removeItem(PENDING_TX);
      return null;
    }
    return pending;
  }

  async function dispatchChain(
    txConfig: ChainConfig,
    txInput: Parameters<typeof sendContract>[1],
    body: Record<string, unknown>,
    view: Omit<TxView, "phase">,
    success: string,
  ) {
    const existing = samePending(String(body.purpose ?? ""), view.agreementId, view.milestoneId);
    const hash = existing?.hash ?? await sendContract(txConfig, txInput);
    const result = await report(hash, body, view);
    if (result.status === "confirmed") setNotice({ tone: "ok", title: success });
    return result;
  }

  async function sendOrResume(
    txConfig: ChainConfig,
    txInput: Parameters<typeof sendContract>[1],
    body: Record<string, unknown>,
    view: Omit<TxView, "phase">,
    success: string,
  ) {
    if (moneyBusy.current) {
      setNotice({ tone: "danger", title: "A transaction is already in progress. It was not sent again." });
      return { status: "pending", settled: false, detail: "A transaction is already in progress. It was not sent again." };
    }
    moneyBusy.current = true;
    try {
      return await dispatchChain(txConfig, txInput, body, view, success);
    } finally {
      moneyBusy.current = false;
    }
  }

  useEffect(() => {
    if (!profile || resumed.current) return;
    const pending = readPending();
    if (!pending) return;
    resumed.current = true;
    void report(pending.hash, {
      purpose: pending.purpose,
      agreementId: pending.agreementId,
      milestoneId: pending.milestoneId,
      submissionId: pending.submissionId,
    }, { kind: pending.kind, agreementId: pending.agreementId, milestoneId: pending.milestoneId, title: pending.title });
  }, [profile]);

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
        sessionKind.current = "siwe";
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
        sessionKind.current = null;
        sessionStorage.removeItem("proofpay.next");
        sessionStorage.removeItem(PENDING_TX);
        sessionStorage.removeItem(PENDING_APPROVAL);
        sessionStorage.removeItem(`${PENDING_APPROVAL}At`);
        sessionStorage.removeItem("proofpay.pendingFaucet");
        resumed.current = false;
        if (auth.configured) await auth.privyLogout().catch(() => undefined);
        setProfile(null);
        setConnected(null);
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
        const view = { kind: "fund" as LedgerKind, agreementId: "", milestoneId: "", title: "Get test tUSDC" };
        setTx({ ...view, phase: "awaiting" });
        try {
          const stored = sessionStorage.getItem("proofpay.pendingFaucet");
          const hash = (stored && /^0x[a-fA-F0-9]{64}$/.test(stored) ? stored : null) as Hash | null
            ?? await sendContract(config, {
              account: getAddress(profile.wallet),
              address: config.token,
              abi: tokenAbi,
              functionName: "faucet",
              args: [],
            });
          sessionStorage.setItem("proofpay.pendingFaucet", hash);
          setTx({ ...view, phase: "pending" });
          if (config.rpcUrl) {
            const reader = createPublicClient({ chain: walletChain(config), transport: http(config.rpcUrl) });
            const receipt = await reader.waitForTransactionReceipt({ hash, timeout: 90_000 });
            if (receipt.status !== "success") throw new Error("The test-token mint reverted. No tokens were added.");
          }
          sessionStorage.removeItem("proofpay.pendingFaucet");
          setTx({ ...view, phase: "success", title: "Test tUSDC received" });
          setNotice({ tone: "ok", title: "Test tUSDC was added to this wallet. It has no monetary value." });
        } catch (error) {
          const rejected = rejectedByWallet(error);
          if (rejected) sessionStorage.removeItem("proofpay.pendingFaucet");
          setTx({ ...view, phase: rejected ? "rejected" : "unknown" });
          if (!rejected) setNotice({ tone: "danger", title: "The test-token mint is not confirmed yet. It was not sent again." });
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
      confirmClient: async (id) => {
        try {
          await api(`/api/agreements/${id}/confirm-client`, { method: "POST", body: "{}" });
          await refresh();
          setNotice({ tone: "ok", title: "Client wallet confirmed. Funding stays closed until both of you accept and the client funds a milestone." });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Could not confirm the client." };
        }
      },
      declineClient: async (id) => {
        try {
          await api(`/api/agreements/${id}/decline-client`, { method: "POST", body: "{}" });
          await refresh();
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Could not decline that wallet." };
        }
      },
      switchWallet: async (wallet) => {
        if (auth.configured) await auth.focusWallet(wallet);
        const saved = await api<{ user: Profile }>("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ activeWallet: wallet, displayName: profileRef.current?.displayName }),
        });
        setProfile(saved.user);
        setConnected(getAddress(saved.user.wallet));
      },
      saveAgreement: async (existingId, form: AgreementInput, mode) => {
        try {
          const inviting = mode === "invite";
          const saved = await api<{ agreement: Agreement }>(existingId ? `/api/agreements/${existingId}` : "/api/agreements", {
            method: existingId ? "PATCH" : "POST",
            body: JSON.stringify({ ...form, invite: inviting && !form.clientWallet.trim() }),
          });
          if (inviting) {
            const invite = await api<{ path: string }>(`/api/agreements/${saved.agreement.id}/invitation`, { method: "POST", body: "{}" });
            await refresh();
            setNotice({ tone: "ok", title: "Invitation created. Send the link to the client. It does not let them fund or change your wallet." });
            return { ok: true, id: saved.agreement.id, path: invite.path };
          }
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
            const result = await sendOrResume(config, {
              account: getAddress(profile.wallet),
              address: commit.escrow,
              abi: escrowAbi,
              functionName: "createAgreement",
              args: [commit.client, commit.termsHash, commit.amounts.map((amount) => BigInt(amount))],
            }, { purpose: "create", agreementId: saved.agreement.id }, view, "Terms committed. The client can accept this version.");
            if (result.status === "reverted" || result.status === "unmatched" || result.status === "rejected") {
              return { ok: false, error: result.detail || "The agreement was not committed. The draft is still saved." };
            }
          } catch (error) {
            await failWallet(error, { purpose: "create", agreementId: saved.agreement.id }, view);
            return { ok: false, error: rejectedByWallet(error) ? "You rejected the wallet request. The draft is still saved." : "The agreement was not committed. The draft is still saved." };
          }
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
          await sendOrResume(config, {
            account: getAddress(profile.wallet),
            address: prepared.escrow,
            abi: escrowAbi,
            functionName: "accept",
            args: [BigInt(prepared.chainAgreementId), prepared.termsHash],
          }, { purpose: "accept", agreementId: id }, view, "Terms accepted. Milestones stay unfunded until you fund them.");
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
          await sendOrResume(config, {
            account: getAddress(profile.wallet),
            address: prepared.escrow,
            abi: escrowAbi,
            functionName: "submit",
            args: [BigInt(prepared.chainAgreementId), BigInt(prepared.index), prepared.ref],
          }, { purpose: "submit", agreementId: input.agreementId, milestoneId: input.milestoneId, submissionId }, view, "Work submitted. Payment stays held until the client approves it.");
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
          await sendOrResume(config, {
            account: getAddress(profile.wallet),
            address: prepared.escrow,
            abi: escrowAbi,
            functionName: "requestChanges",
            args: [BigInt(prepared.chainAgreementId), BigInt(prepared.index)],
          }, { purpose: "changes", agreementId: input.agreementId, milestoneId: input.milestoneId }, view, "Changes requested. The funds stay held.");
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
          await sendOrResume(config, {
            account: getAddress(profile.wallet),
            address: config.escrow,
            abi: escrowAbi,
            functionName: "withdrawCancel",
            args: [BigInt(agreement.chainAgreementId), BigInt(index)],
          }, { purpose: "withdraw", agreementId: input.agreementId, milestoneId: input.milestoneId }, view, "Proposal withdrawn. The funds stay held.");
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
        if (moneyBusy.current) {
          setNotice({ tone: "danger", title: "A transaction is already in progress. It was not sent again." });
          return;
        }
        moneyBusy.current = true;
        try {
          await ensureChain(config);
          const account = getAddress(profile.wallet);
          if (input.kind === "fund") {
            const reader = createPublicClient({ chain: walletChain(config), transport: http(config.rpcUrl) });
            const needed = BigInt(milestone.amount) * 10_000n;
            const allowance = await reader.readContract({ address: config.token, abi: tokenAbi, functionName: "allowance", args: [account, config.escrow] });
            if (allowance < needed) {
              const stored = sessionStorage.getItem(PENDING_APPROVAL);
              const storedAt = Number(sessionStorage.getItem(`${PENDING_APPROVAL}At`) || 0);
              const approvalFresh = Boolean(stored && Date.now() - storedAt < 3 * 60 * 1000);
              let approval = (approvalFresh && stored && /^0x[a-fA-F0-9]{64}$/.test(stored) ? stored : null) as Hash | null;
              if (!approval) {
                setTx({ ...view, phase: "awaiting", title: "Allow the exact tUSDC amount" });
                approval = await sendContract(config, { account, address: config.token, abi: tokenAbi, functionName: "approve", args: [config.escrow, needed] });
                sessionStorage.setItem(PENDING_APPROVAL, approval);
                sessionStorage.setItem(`${PENDING_APPROVAL}At`, String(Date.now()));
              }
              setTx({ ...view, phase: "pending", title: "Confirming token allowance" });
              try {
                const receipt = await reader.waitForTransactionReceipt({ hash: approval, timeout: 90_000 });
                sessionStorage.removeItem(PENDING_APPROVAL);
                sessionStorage.removeItem(`${PENDING_APPROVAL}At`);
                void receipt;
              } catch (error) {
                if (rejectedByWallet(error)) {
                  sessionStorage.removeItem(PENDING_APPROVAL);
                  sessionStorage.removeItem(`${PENDING_APPROVAL}At`);
                }
                throw error;
              }
            } else {
              sessionStorage.removeItem(PENDING_APPROVAL);
              sessionStorage.removeItem(`${PENDING_APPROVAL}At`);
            }
            const deposit = { ...view, title: "Deposit into escrow" };
            setTx({ ...deposit, phase: "awaiting" });
            await dispatchChain(config, { account, address: config.escrow, abi: escrowAbi, functionName: "fund", args: [BigInt(agreement.chainAgreementId), BigInt(index)] }, { purpose: "fund", agreementId: input.agreementId, milestoneId: input.milestoneId }, deposit, "The deposit is confirmed. The amount is held in escrow. The freelancer has not been paid.");
            return;
          }
          if (input.kind === "release") {
            setTx({ ...view, phase: "awaiting" });
            await dispatchChain(config, { account, address: config.escrow, abi: escrowAbi, functionName: "release", args: [BigInt(agreement.chainAgreementId), BigInt(index)] }, { purpose: "release", agreementId: input.agreementId, milestoneId: input.milestoneId }, view, "Payment released. The freelancer received this milestone.");
            return;
          }
          setTx({ ...view, phase: "awaiting" });
          await dispatchChain(config, {
            account,
            address: config.escrow,
            abi: escrowAbi,
            functionName: "approveCancel",
            args: [BigInt(agreement.chainAgreementId), BigInt(index), BigInt(input.proposalId || milestone.cancellation?.id || "0")],
          }, { purpose: "refund", agreementId: input.agreementId, milestoneId: input.milestoneId }, view, "Cancellation confirmed. The full amount went back to the client.");
        } catch (error) {
          const pendingHash = hashFromError(error) ?? (sessionStorage.getItem(PENDING_APPROVAL) as Hash | null);
          if (pendingHash && !rejectedByWallet(error)) {
            setTx({ ...view, phase: "unknown" });
            setNotice({ tone: "danger", title: "That transaction is still unconfirmed. It was not sent again." });
          } else {
            await failWallet(error, { purpose: input.kind, agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
          }
        } finally {
          moneyBusy.current = false;
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
        await sendOrResume(config, {
          account: getAddress(profile.wallet),
          address: prepared.escrow,
          abi: escrowAbi,
          functionName: "proposeCancel",
          args: [BigInt(prepared.chainAgreementId), BigInt(prepared.index)],
        }, { purpose: "propose", agreementId: input.agreementId, milestoneId: input.milestoneId }, view, success);
        return { ok: true as const };
      } catch (error) {
        if (!(error instanceof ApiError)) await failWallet(error, { purpose: "propose", agreementId: input.agreementId, milestoneId: input.milestoneId }, view);
        return { ok: false as const, error: error instanceof Error ? error.message : "The proposal was not recorded." };
      }
      void index;
    }
  }, [auth, config, notice, previewLoading, profile, refresh, state, tx, walletMessage]);

  return <DemoContext.Provider value={apiValue}>{children}</DemoContext.Provider>;
}
