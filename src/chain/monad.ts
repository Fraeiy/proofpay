import { defineChain } from "viem";

/** Monad testnet, from https://docs.monad.xyz/developer-essentials/testnet */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  testnet: true,
});

export const MONAD_FAUCET_URL = "https://faucet.monad.xyz";
