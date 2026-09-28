/**
 * Two-wallet proof against a local Hardhat chain and the real API.
 * The keys below are Hardhat's published development accounts.
 * They are used only for http://127.0.0.1 and are not Monad keys.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../server/app.mjs";
import { escrowAbi, tokenAbi } from "../shared/protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8546;
const rpcUrl = `http://127.0.0.1:${port}`;
const origin = "http://127.0.0.1:5174";
const hardhat = path.join(root, "node_modules", "hardhat", "internal", "cli", "bootstrap.js");

const freelancer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const client = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

const chain = defineChain({
  id: 31337,
  name: "ProofPay local chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}

function startNode() {
  const child = spawn(process.execPath, [hardhat, "node", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log += chunk.toString(); });
  return { child, readLog: () => log };
}

function stopNode(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForRpc(child, readLog) {
  const started = Date.now();
  while (Date.now() - started < 60000) {
    if (child.exitCode != null) fail(`Hardhat node exited early.\n${readLog()}`);
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (response.ok) return;
    } catch {
      // node is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  fail(`Hardhat node did not answer.\n${readLog()}`);
}

function runDeploy(deployFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hardhat, "run", "scripts/deploy.cjs", "--network", "localhost"], {
      cwd: root,
      env: { ...process.env, LOCAL_RPC_URL: rpcUrl, PROOFPAY_DEPLOYMENT: deployFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output || `deploy exited ${code}`));
    });
  });
}

function headers(cookie) {
  return {
    origin,
    "content-type": "application/json",
    "x-proofpay-request": "1",
    ...(cookie ? { cookie } : {}),
  };
}

async function signIn(base, account) {
  const challenge = await fetch(`${base}/api/auth/challenge`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ address: account.address, chainId: 31337 }),
  });
  const issued = await challenge.json();
  if (challenge.status !== 200) fail(issued.error || "challenge failed");
  const signature = await account.signMessage({ message: issued.message });
  const verified = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: issued.message, signature }),
  });
  const body = await verified.json();
  const cookie = verified.headers.getSetCookie?.()[0]?.split(";")[0];
  if (verified.status !== 200 || !cookie) fail(body.error || "sign-in failed");
  return cookie;
}

async function api(base, cookie, pathName, init = {}) {
  const response = await fetch(`${base}${pathName}`, {
    ...init,
    headers: headers(cookie),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { status: response.status, data, bytes: Buffer.from(text) };
}

function pdfText(bytes) {
  const raw = bytes.toString("latin1");
  const pieces = [raw];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = Buffer.from(match[1] ?? "", "latin1");
    try { pieces.push(inflateSync(body).toString("latin1")); } catch { pieces.push(body.toString("latin1")); }
  }
  return pieces.join("\n").replace(/<([0-9A-Fa-f\s]+)>/g, (token, hex) => {
    const compact = hex.replace(/\s+/g, "");
    if (compact.length < 4 || compact.length % 2 !== 0) return token;
    return Buffer.from(compact, "hex").toString("latin1");
  });
}

async function main() {
  const { child, readLog } = startNode();
  const temp = mkdtempSync(path.join(tmpdir(), "proofpay-flow-"));
  const deployFile = path.join(temp, "deployment.json");
  let apiServer;
  try {
    await waitForRpc(child, readLog);
    await runDeploy(deployFile);
    const deployed = JSON.parse(readFileSync(deployFile, "utf8"));
    const reader = createPublicClient({ chain, transport: http(rpcUrl) });
    const freelancerWallet = createWalletClient({ account: freelancer, chain, transport: http(rpcUrl) });
    const clientWallet = createWalletClient({ account: client, chain, transport: http(rpcUrl) });
    const app = createApp({
      dataFile: ":memory:",
      origins: [origin],
      chain: {
        chainId: 31337,
        rpcUrl,
        escrow: deployed.escrow,
        token: deployed.token,
        explorer: "",
        name: "ProofPay local chain",
      },
    });
    await new Promise((resolve) => { apiServer = app.server; app.server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${app.server.address().port}`;

    const freeCookie = await signIn(base, freelancer);
    const clientCookie = await signIn(base, client);
    const strangerCookie = await signIn(base, stranger);
    await api(base, freeCookie, "/api/me", { method: "PATCH", body: JSON.stringify({ displayName: "Amara Cole", preferredView: "client", onboarded: true }) });
    await api(base, clientCookie, "/api/me", { method: "PATCH", body: JSON.stringify({ displayName: "Northline Labs", intent: "hire", preferredView: "client", onboarded: true }) });

    const created = await api(base, freeCookie, "/api/agreements", {
      method: "POST",
      body: JSON.stringify({
        title: "Northline weekly social",
        clientName: "Northline Labs",
        clientWallet: client.address,
        description: "Four weeks of posts, replies, and a Friday activity report for the launch.",
        milestones: [
          { id: "week-1", title: "Week 1 report", deliverables: ["Five posts"], amount: "420.00", dueDate: "2026-10-07" },
          { id: "week-2", title: "Week 2 report", deliverables: ["Five posts"], amount: "180.00", dueDate: "2026-10-14" },
        ],
      }),
    });
    if (created.status !== 200) fail(JSON.stringify(created.data));
    const agreementId = created.data.agreement.id;
    const hidden = await api(base, clientCookie, `/api/agreements/${agreementId}`);
    if (hidden.status !== 404 || JSON.stringify(hidden.data).includes("Northline weekly")) fail("draft leaked to the client");

    const committed = await api(base, freeCookie, `/api/agreements/${agreementId}/commit`, { method: "POST", body: "{}" });
    if (committed.status !== 200) fail(JSON.stringify(committed.data));
    const createHash = await freelancerWallet.writeContract({
      address: committed.data.escrow,
      abi: escrowAbi,
      functionName: "createAgreement",
      args: [committed.data.client, committed.data.termsHash, committed.data.amounts.map((amount) => BigInt(amount))],
    });
    await reader.waitForTransactionReceipt({ hash: createHash });
    const createdTx = await api(base, freeCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "create", agreementId, txHash: createHash }) });
    if (createdTx.data.status !== "confirmed") fail(JSON.stringify(createdTx.data));

    const earlyFund = await clientWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [1n, 0n],
    }).then(() => "sent", (error) => error.shortMessage || error.message);
    if (!/reverted|NotAccepted/i.test(String(earlyFund))) fail(`funding before acceptance was accepted: ${earlyFund}`);

    const workspace = await api(base, clientCookie, "/api/workspace");
    const agreement = workspace.data.agreements.find((item) => item.id === agreementId);
    if (!agreement?.chainAgreementId) fail("client cannot see the committed agreement");
    const leaked = await api(base, strangerCookie, `/api/agreements/${agreementId}`);
    if (leaked.status !== 404 || JSON.stringify(leaked.data).includes("Northline weekly")) fail("private brief leaked");

    const accepted = await api(base, clientCookie, `/api/agreements/${agreementId}/accept`, { method: "POST", body: "{}" });
    const acceptHash = await clientWallet.writeContract({
      address: accepted.data.escrow,
      abi: escrowAbi,
      functionName: "accept",
      args: [BigInt(accepted.data.chainAgreementId), accepted.data.termsHash],
    });
    await reader.waitForTransactionReceipt({ hash: acceptHash });
    const acceptTx = await api(base, clientCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "accept", agreementId, txHash: acceptHash }) });
    if (acceptTx.data.status !== "confirmed") fail(JSON.stringify(acceptTx.data));

    const week1 = agreement.milestones[0].id;
    const spoofed = await api(base, clientCookie, `/api/milestones/${week1}/submission`, {
      method: "POST",
      body: JSON.stringify({ role: "freelancer", note: "I am pretending to be the freelancer here.", links: [{ label: "Report", url: "https://example.com/report" }] }),
    });
    if (spoofed.status !== 403) fail("client role flag was trusted for submission");

    await clientWallet.writeContract({ address: deployed.token, abi: tokenAbi, functionName: "faucet" });
    const needed = 420n * 1_000_000n;
    const approveHash = await clientWallet.writeContract({
      address: deployed.token,
      abi: tokenAbi,
      functionName: "approve",
      args: [deployed.escrow, needed],
    });
    await reader.waitForTransactionReceipt({ hash: approveHash });
    const fundHash = await clientWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [BigInt(agreement.chainAgreementId), 0n],
    });
    await reader.waitForTransactionReceipt({ hash: fundHash });
    const fundTx = await api(base, clientCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "fund", agreementId, milestoneId: week1, txHash: fundHash }) });
    if (fundTx.data.status !== "confirmed") fail(JSON.stringify(fundTx.data));
    const duplicate = await clientWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [BigInt(agreement.chainAgreementId), 0n],
    }).then(() => "sent", (error) => error.shortMessage || error.message);
    if (!/reverted|BadPhase/i.test(String(duplicate))) fail("duplicate funding was accepted");

    const submitted = await api(base, freeCookie, `/api/milestones/${week1}/submission`, {
      method: "POST",
      body: JSON.stringify({ note: "Week 1 activity report is ready for review.", links: [{ label: "Activity report", url: "https://example.com/week-1" }] }),
    });
    if (submitted.status !== 200) fail(JSON.stringify(submitted.data));
    const submitHash = await freelancerWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "submit",
      args: [BigInt(agreement.chainAgreementId), 0n, submitted.data.ref],
    });
    await reader.waitForTransactionReceipt({ hash: submitHash });
    await api(base, freeCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "submit", agreementId, milestoneId: week1, submissionId: submitted.data.submissionId, txHash: submitHash }) });

    const blockedRelease = await api(base, freeCookie, "/api/me", { method: "PATCH", body: JSON.stringify({ preferredView: "client" }) });
    if (blockedRelease.data.user.preferredView !== "client") fail("view preference did not save");
    const changesDenied = await api(base, freeCookie, `/api/milestones/${week1}/changes`, {
      method: "POST",
      body: JSON.stringify({ role: "client", reason: "The view switch must not make me the client." }),
    });
    if (changesDenied.status !== 403) fail("freelancer gained client permission by switching view");

    const changes = await api(base, clientCookie, `/api/milestones/${week1}/changes`, {
      method: "POST",
      body: JSON.stringify({ reason: "Please add the launch thread link before I release this." }),
    });
    const changesHash = await clientWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "requestChanges",
      args: [BigInt(agreement.chainAgreementId), 0n],
    });
    await reader.waitForTransactionReceipt({ hash: changesHash });
    await api(base, clientCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "changes", agreementId, milestoneId: week1, txHash: changesHash }) });

    const again = await api(base, freeCookie, `/api/milestones/${week1}/submission`, {
      method: "POST",
      body: JSON.stringify({ note: "Added the launch thread and kept the first report.", links: [{ label: "Launch thread", url: "https://example.com/launch" }] }),
    });
    const againHash = await freelancerWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "submit",
      args: [BigInt(agreement.chainAgreementId), 0n, again.data.ref],
    });
    await reader.waitForTransactionReceipt({ hash: againHash });
    await api(base, freeCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "submit", agreementId, milestoneId: week1, submissionId: again.data.submissionId, txHash: againHash }) });

    const releaseHash = await clientWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "release",
      args: [BigInt(agreement.chainAgreementId), 0n],
    });
    await reader.waitForTransactionReceipt({ hash: releaseHash });
    const releaseTx = await api(base, clientCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "release", agreementId, milestoneId: week1, txHash: releaseHash }) });
    if (releaseTx.data.status !== "confirmed") fail(JSON.stringify(releaseTx.data));

    const paidView = await api(base, clientCookie, "/api/workspace");
    const paid = paidView.data.agreements.find((item) => item.id === agreementId);
    const paidMilestone = paid.milestones.find((item) => item.id === week1);
    if (paidMilestone.phase !== "paid" || paidMilestone.submissions.length < 2) fail("reload did not keep the payment and submission history");
    const receiptEntry = paidView.data.ledger.find((item) => item.kind === "release" && item.result === "confirmed");
    const depositEntry = paidView.data.ledger.find((item) => item.kind === "fund" && item.result === "confirmed");
    if (!receiptEntry?.txHash || receiptEntry.txHash.toLowerCase() !== releaseHash.toLowerCase()) fail("receipt is not tied to the release transaction");
    const receipt = await fetch(`${base}/api/receipts/${receiptEntry.id}.pdf`, { headers: headers(clientCookie) });
    const receiptBytes = Buffer.from(await receipt.arrayBuffer());
    const receiptText = pdfText(receiptBytes);
    if (receipt.status !== 200) fail("receipt download failed");
    for (const needle of ["TESTNET PAYMENT", "NO REAL MONETARY VALUE", "420.00", releaseHash, "Northline weekly social", "Week 1 report"]) {
      if (!receiptText.includes(needle)) fail(`receipt missing ${needle}`);
    }
    if (!/not a tax invoice/i.test(receiptText)) fail("receipt did not say it is not a tax invoice");
    const depositPdf = await fetch(`${base}/api/receipts/${depositEntry.id}.pdf`, { headers: headers(freeCookie) });
    const depositText = pdfText(Buffer.from(await depositPdf.arrayBuffer()));
    if (!depositText.includes("Deposit confirmation") || !depositText.includes("not a payment received by the freelancer")) fail("deposit was labelled as freelancer income");
    const strangerPdf = await fetch(`${base}/api/receipts/${receiptEntry.id}.pdf`, { headers: headers(strangerCookie) });
    if (strangerPdf.status !== 404) fail("receipt was public");

    if (paid.milestones.length < 2) fail("second milestone was not stored");
    const week2 = paid.milestones[1].id;
    const secondNeeded = 180n * 1_000_000n;
    const secondApprove = await clientWallet.writeContract({
      address: deployed.token,
      abi: tokenAbi,
      functionName: "approve",
      args: [deployed.escrow, secondNeeded],
    });
    await reader.waitForTransactionReceipt({ hash: secondApprove });
    const secondFund = await clientWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [BigInt(agreement.chainAgreementId), 1n],
    });
    const secondFundReceipt = await reader.waitForTransactionReceipt({ hash: secondFund });
    if (secondFundReceipt.status !== "success") fail("second milestone funding reverted");
    const secondFundTx = await api(base, clientCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "fund", agreementId, milestoneId: week2, txHash: secondFund }) });
    if (secondFundTx.data.status !== "confirmed") fail(JSON.stringify(secondFundTx.data));
    const proposed = await api(base, freeCookie, `/api/milestones/${week2}/cancel`, {
      method: "POST",
      body: JSON.stringify({ note: "We both want this unpaid week refunded to the client." }),
    });
    if (proposed.status !== 200) fail(JSON.stringify(proposed.data));
    const proposeHash = await freelancerWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "proposeCancel",
      args: [BigInt(proposed.data.chainAgreementId), BigInt(proposed.data.index)],
    });
    await reader.waitForTransactionReceipt({ hash: proposeHash });
    await api(base, freeCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "propose", agreementId, milestoneId: week2, txHash: proposeHash }) });
    const open = await reader.readContract({ address: deployed.escrow, abi: escrowAbi, functionName: "milestone", args: [BigInt(agreement.chainAgreementId), 1n] });
    const nonce = open.cancelNonce ?? open[4];
    if (nonce == null) {
      const seen = JSON.stringify(open, (_, value) => (typeof value === "bigint" ? value.toString() : value));
      fail(`cancellation nonce was missing: ${seen}`);
    }
    const refundHash = await clientWallet.writeContract({
      address: deployed.escrow,
      abi: escrowAbi,
      functionName: "approveCancel",
      args: [BigInt(agreement.chainAgreementId), 1n, nonce],
    });
    await reader.waitForTransactionReceipt({ hash: refundHash });
    const refundTx = await api(base, clientCookie, "/api/tx", { method: "POST", body: JSON.stringify({ purpose: "refund", agreementId, milestoneId: week2, txHash: refundHash }) });
    if (refundTx.data.status !== "confirmed") fail(JSON.stringify(refundTx.data));

    const escrowBalance = await reader.readContract({ address: deployed.token, abi: tokenAbi, functionName: "balanceOf", args: [deployed.escrow] });
    const freelancerBalance = await reader.readContract({ address: deployed.token, abi: tokenAbi, functionName: "balanceOf", args: [freelancer.address] });
    if (escrowBalance !== 0n) fail(`escrow still holds ${escrowBalance}`);
    if (freelancerBalance !== 420n * 1_000_000n) fail(`freelancer balance ${freelancerBalance}`);
    const finalView = await api(base, freeCookie, "/api/workspace");
    const finalAgreement = finalView.data.agreements.find((item) => item.id === agreementId);
    if (finalAgreement.milestones[0].phase !== "paid" || finalAgreement.milestones[1].phase !== "refunded") fail("final phases did not match the chain");
    const freelanceOnly = finalView.data.agreements.filter((item) => item.freelancer.wallet.toLowerCase() === freelancer.address.toLowerCase());
    if (freelanceOnly.length !== 1) fail("freelancer history was not kept");
    console.log("local two-wallet flow confirmed");
    console.log(JSON.stringify({
      chainId: 31337,
      token: deployed.token,
      escrow: deployed.escrow,
      release: releaseHash,
      refund: refundHash,
      paid: "420.00 tUSDC",
      refunded: "180.00 tUSDC",
    }));
  } finally {
    apiServer?.close();
    stopNode(child);
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
