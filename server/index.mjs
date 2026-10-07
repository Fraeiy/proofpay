import { readFileSync, existsSync } from "node:fs";
import { createApp } from "./app.mjs";

function loadEnvFile() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] != null && process.env[key] !== "") continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

function loadDeployment() {
  const file = process.env.PROOFPAY_DEPLOYMENT || "data/deployment.json";
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8"));
}

const deployed = loadDeployment();
const origins = (process.env.PROOFPAY_ORIGINS || "http://127.0.0.1:5174,http://localhost:5174,https://proofpay-pi.vercel.app").split(",").map((item) => item.trim()).filter(Boolean);
const chainId = Number(process.env.CHAIN_ID || deployed.chainId || 10143);

const { server } = createApp({
  dataFile: process.env.PROOFPAY_DB || "data/proofpay.sqlite",
  origins,
  secureCookie: process.env.COOKIE_SECURE === "1",
  chain: {
    chainId,
    rpcUrl: process.env.MONAD_RPC_URL || deployed.rpc || "https://testnet-rpc.monad.xyz",
    escrow: process.env.ESCROW_ADDRESS || deployed.escrow || "",
    token: process.env.TOKEN_ADDRESS || deployed.token || "",
    explorer: chainId === 10143 ? (process.env.EXPLORER_URL || deployed.explorer || "https://testnet.monadvision.com") : (process.env.EXPLORER_URL || deployed.explorer || ""),
    name: chainId === 10143 ? "Monad Testnet" : "ProofPay local chain",
  },
});

const port = Number(process.env.PORT || 8792);
server.listen(port, "127.0.0.1", () => {
  console.log(`ProofPay API listening on http://127.0.0.1:${port}`);
});
