import { mkdirSync, writeFileSync } from "node:fs";
import { buildReceiptPdf } from "../server/receipt.mjs";

const bytes = await buildReceiptPdf({
  sample: true,
  heading: "Payment receipt",
  status: "Sample layout",
  amountLabel: "420.00 tUSDC",
  reference: "sample-receipt-not-a-transaction",
  agreementTitle: "Four-week social management for a fictional studio with a title long enough to wrap",
  agreementRef: "agr_sample",
  milestoneTitle: "Week 3 · Recap and report",
  fromName: "Fictional Client",
  fromWallet: "0x0000000000000000000000000000000000000001",
  toName: "Fictional Freelancer With A Long Display Name That Wraps",
  toWallet: "0x0000000000000000000000000000000000000002",
  token: "tUSDC · ProofPay Test Token · 6 decimals · no monetary value",
  network: "Sample layout · not a network",
  confirmedAt: "Not a confirmed transaction",
  txHash: "None. This sample has no transaction hash.",
  explorerUrl: "",
  note: "Fictional demonstration. This file is not a confirmed payment and it has no explorer link.",
});

mkdirSync("docs", { recursive: true });
writeFileSync("docs/sample-receipt.pdf", bytes);
console.log("docs/sample-receipt.pdf");
