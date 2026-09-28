import { createApp } from "../server/app.mjs";

const origins = (process.env.PROOFPAY_ORIGINS || "http://127.0.0.1:5174,http://localhost:5174")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const chainId = Number(process.env.CHAIN_ID || 10143);

const { handle } = createApp({
  dataFile: process.env.PROOFPAY_DB || "/tmp/proofpay.sqlite",
  origins,
  secureCookie: process.env.COOKIE_SECURE === "1" || process.env.VERCEL === "1",
  chain: {
    chainId,
    rpcUrl: process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
    escrow: process.env.ESCROW_ADDRESS || "",
    token: process.env.TOKEN_ADDRESS || "",
    explorer: process.env.EXPLORER_URL || "https://testnet.monadvision.com",
    name: chainId === 10143 ? "Monad Testnet" : "ProofPay local chain",
  },
});

export default function handler(req, res) {
  const url = req.url || "/";
  if (!url.startsWith("/api")) {
    const path = url.startsWith("/") ? url : `/${url}`;
    req.url = path === "/" ? "/api" : `/api${path}`;
  }
  return handle(req, res);
}
