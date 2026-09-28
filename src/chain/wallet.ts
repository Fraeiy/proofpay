import { createWalletClient, custom, getAddress, type Abi, type Address, type Chain, type Hash } from "viem";
import { defineChain } from "viem";

export type ChainConfig = {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  escrow: Address | null;
  token: Address | null;
  explorer: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
  configured: boolean;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export function ethereum(): EthereumProvider | null {
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return provider ?? null;
}

export function walletChain(config: ChainConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: config.explorer ? { default: { name: "Explorer", url: config.explorer } } : undefined,
  });
}

export async function connectAccount(): Promise<Address> {
  const provider = ethereum();
  if (!provider) throw new Error("No wallet was found. On a phone, open ProofPay in your wallet’s browser and try again.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const account = accounts[0];
  if (!account) throw new Error("Choose an account in your wallet to continue.");
  return getAddress(account);
}

export async function currentAccount(): Promise<Address | null> {
  const provider = ethereum();
  if (!provider) return null;
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  return accounts[0] ? getAddress(accounts[0]) : null;
}

export async function currentChainId(): Promise<number | null> {
  const provider = ethereum();
  if (!provider) return null;
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number(hex);
}

export async function ensureChain(config: ChainConfig) {
  const provider = ethereum();
  if (!provider) throw new Error("No wallet was found.");
  const hex = `0x${config.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code: number }).code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex,
        chainName: config.chainName,
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: [config.rpcUrl],
        blockExplorerUrls: config.explorer ? [config.explorer] : [],
      }],
    });
  }
}

export async function signLogin(account: Address, message: string) {
  const provider = ethereum();
  if (!provider) throw new Error("No wallet was found.");
  const client = createWalletClient({ account, transport: custom(provider) });
  return client.signMessage({ account, message });
}

export async function sendContract(config: ChainConfig, input: {
  account: Address;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}): Promise<Hash> {
  const provider = ethereum();
  if (!provider) throw new Error("No wallet was found.");
  const client = createWalletClient({ account: input.account, chain: walletChain(config), transport: custom(provider) });
  return client.writeContract({
    account: input.account,
    address: input.address,
    abi: input.abi,
    functionName: input.functionName,
    args: input.args,
    chain: walletChain(config),
  });
}

export function rejectedByWallet(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code: number }).code) : 0;
  const message = error instanceof Error ? error.message : String(error);
  return code === 4001 || /user rejected|user denied|rejected the request/i.test(message);
}
