import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PrivyProvider, useCreateWallet, useExportWallet, useLoginWithEmail, useLoginWithOAuth, usePrivy, useWallets } from "@privy-io/react-auth";
import { getAddress } from "viem";
import { monadTestnet } from "../chain/monad";
import { setActiveProvider, type EthereumProvider } from "../chain/wallet";

export type AuthApi = {
  configured: boolean;
  ready: boolean;
  authenticated: boolean;
  error: string;
  walletReady: boolean;
  signerAddress: string | null;
  linkedCount: number;
  continueGoogle: () => void;
  continueX: () => void;
  sendEmailCode: (email: string) => Promise<string>;
  submitEmailCode: (code: string) => Promise<void>;
  connectWallet: () => void;
  linkWallet: () => void;
  exportWallet: () => Promise<void>;
  retryWallet: () => Promise<void>;
  privyLogout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  focusWallet: (address: string) => Promise<void>;
};

const missing = "Google and email sign-in need a Privy app id in VITE_PRIVY_APP_ID.";

const disabled: AuthApi = {
  configured: false,
  ready: true,
  authenticated: false,
  error: "",
  walletReady: false,
  signerAddress: null,
  linkedCount: 0,
  continueGoogle: () => undefined,
  continueX: () => undefined,
  sendEmailCode: async () => { throw new Error(missing); },
  submitEmailCode: async () => { throw new Error(missing); },
  connectWallet: () => undefined,
  linkWallet: () => undefined,
  exportWallet: async () => undefined,
  retryWallet: async () => undefined,
  privyLogout: async () => undefined,
  getAccessToken: async () => null,
  focusWallet: async () => undefined,
};

const AuthContext = createContext<AuthApi>(disabled);

export function useAuth() {
  return useContext(AuthContext);
}

function linkedEthereum(user: { linkedAccounts: Array<{ type: string; address?: string; chainType?: string; walletClientType?: string }> } | null) {
  return (user?.linkedAccounts ?? []).filter((account) => account.type === "wallet" && account.address && account.chainType !== "solana");
}

function oauthFailure(provider: "google" | "twitter", reason: unknown) {
  const message = reason instanceof Error ? reason.message : "";
  const name = provider === "google" ? "Google" : "X";
  if (/not allowed/i.test(message)) {
    return `${name} sign-in is turned off for this Privy app. Open the Privy dashboard, then Configuration, Login methods, enable ${name}, and save.`;
  }
  return message || `${name} sign-in did not finish.`;
}

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken, linkWallet } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { initOAuth } = useLoginWithOAuth();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { exportWallet } = useExportWallet();
  const [error, setError] = useState("");
  const [walletReady, setWalletReady] = useState(false);
  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const creating = useRef(false);
  const createFailed = useRef(false);
  const linked = linkedEthereum(user);
  const walletKey = wallets.map((wallet) => `${wallet.address}:${wallet.walletClientType}`).join("|");
  const linkedKey = linked.map((account) => account.address).join("|");

  async function bind(address: string) {
    const match = wallets.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase());
    if (!match) throw new Error("Connect that wallet before using it for a transaction.");
    const provider = await match.getEthereumProvider();
    setActiveProvider(provider as EthereumProvider);
    setSignerAddress(getAddress(match.address));
    setWalletReady(true);
    setError("");
  }

  async function ensureWallet() {
    if (!authenticated || !walletsReady) return;
    const embedded = linked.find((account) => account.walletClientType === "privy" && account.address) ?? linked.find((account) => account.address);
    if (!embedded && wallets.length === 0) {
      if (creating.current || createFailed.current) return;
      creating.current = true;
      try {
        await createWallet({ createAdditional: false });
        setError("");
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "The wallet could not be created.";
        if (/already/i.test(message)) return;
        createFailed.current = true;
        setError(`${message} Retrying will not create a second wallet.`);
      } finally {
        creating.current = false;
      }
      return;
    }
    const preferred = wallets.find((wallet) => wallet.walletClientType === "privy") ?? wallets[0];
    if (preferred) {
      try {
        const provider = await preferred.getEthereumProvider();
        setActiveProvider(provider as EthereumProvider);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The wallet could not be connected.");
      }
    }
    const address = preferred?.address ?? embedded?.address;
    if (!address) {
      setWalletReady(false);
      setError("Connect the wallet already linked to this account. A new wallet was not created.");
      return;
    }
    setSignerAddress(getAddress(address));
    setWalletReady(true);
    if (preferred) setError("");
  }

  useEffect(() => {
    if (!ready || !authenticated) {
      setWalletReady(false);
      createFailed.current = false;
      if (!authenticated) {
        setSignerAddress(null);
        setActiveProvider(null);
      }
      return;
    }
    void ensureWallet();
  }, [ready, authenticated, walletsReady, walletKey, linkedKey]);

  const api = useMemo<AuthApi>(() => ({
    configured: true,
    ready,
    authenticated,
    error,
    walletReady,
    signerAddress,
    linkedCount: linked.length,
    continueGoogle: () => {
      setError("");
      void initOAuth({ provider: "google" }).catch((reason: unknown) => setError(oauthFailure("google", reason)));
    },
    continueX: () => {
      setError("");
      void initOAuth({ provider: "twitter" }).catch((reason: unknown) => setError(oauthFailure("twitter", reason)));
    },
    sendEmailCode: async (address) => {
      const email = address.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Enter the email address where the code should be sent.");
      }
      setError("");
      await sendCode({ email });
      return email;
    },
    submitEmailCode: async (raw) => {
      const code = raw.replace(/\D/g, "").slice(0, 6);
      if (code.length !== 6) {
        throw new Error("Enter the 6-digit code from the newest email. Spaces and dashes are ignored.");
      }
      setError("");
      try {
        await loginWithCode({ code });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "";
        if (/invalid email and code/i.test(message)) {
          throw new Error("That code does not match this email. Use the 6-digit code from the newest message, or send a new code. An older code no longer works.");
        }
        if (/passwordless code flow/i.test(message)) {
          throw new Error("That code expired. Send a new code, then enter the 6 digits from that email.");
        }
        throw reason instanceof Error ? reason : new Error("Email sign-in did not finish.");
      }
    },
    connectWallet: () => {
      setError("");
      login({ loginMethods: ["wallet"] });
    },
    linkWallet: () => {
      setError("");
      linkWallet();
    },
    exportWallet: async () => {
      await exportWallet();
    },
    retryWallet: async () => {
      creating.current = false;
      createFailed.current = false;
      setWalletReady(false);
      await ensureWallet();
    },
    privyLogout: async () => {
      setActiveProvider(null);
      setSignerAddress(null);
      setWalletReady(false);
      await logout();
    },
    getAccessToken: () => getAccessToken(),
    focusWallet: bind,
  }), [ready, authenticated, error, walletReady, signerAddress, linked.length, wallets, initOAuth, sendCode, loginWithCode, login, linkWallet, exportWallet, logout, getAccessToken]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function PrivyGate({ children }: { children: ReactNode }) {
  const builtIn = import.meta.env.VITE_PRIVY_APP_ID || "";
  const [appId, setAppId] = useState(builtIn);
  useEffect(() => {
    if (builtIn) return;
    let gone = false;
    void fetch("/api/config").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { privyAppId?: string | null };
      if (!gone && body.privyAppId) setAppId(body.privyAppId);
    }).catch(() => undefined);
    return () => { gone = true; };
  }, [builtIn]);
  if (!appId) return <AuthContext.Provider value={disabled}>{children}</AuthContext.Provider>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
        loginMethods: ["google", "twitter", "email", "wallet"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
