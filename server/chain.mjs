import { createPublicClient, decodeEventLog, defineChain, http, zeroAddress } from "viem";
import { baseUnitsToCents, escrowAbi, sameAddress } from "../shared/protocol.mjs";

const PHASES = ["unfunded", "funded", "submitted", "changes_requested", "paid", "refunded"];
const HELD = new Set(["funded", "submitted", "changes_requested"]);

export function makePublicClient(rpcUrl, chainId) {
  const chain = defineChain({
    id: chainId,
    name: chainId === 10143 ? "Monad Testnet" : "ProofPay local",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

function isoNow() {
  return new Date().toISOString();
}

function milestoneAt(db, agreementId, index) {
  return db.prepare("SELECT * FROM milestones WHERE agreement_id = ? AND position = ?").get(agreementId, index);
}

function names(db, agreement, kind) {
  const clientUser = db.prepare("SELECT display_name FROM users WHERE wallet = ?").get(agreement.client_wallet);
  const freeUser = db.prepare("SELECT display_name FROM users WHERE wallet = ?").get(agreement.freelancer_wallet);
  const clientName = clientUser?.display_name || agreement.client_name;
  const freeName = freeUser?.display_name || "Freelancer";
  if (kind === "refund") {
    return { fromName: "Held in agreement", fromWallet: agreement.freelancer_wallet, toName: clientName, toWallet: agreement.client_wallet };
  }
  if (kind === "fund") {
    return { fromName: clientName, fromWallet: agreement.client_wallet, toName: `Held for ${freeName}`, toWallet: agreement.freelancer_wallet };
  }
  return { fromName: clientName, fromWallet: agreement.client_wallet, toName: freeName, toWallet: agreement.freelancer_wallet };
}

function insertLedger(db, agreement, milestone, kind, result, detail, txHash, logIndex, chainId, blockTime) {
  const who = names(db, agreement, kind);
  db.prepare(`
    INSERT OR IGNORE INTO ledger (
      id, agreement_id, milestone_id, kind, result, amount_cents,
      from_wallet, to_wallet, from_name, to_name, tx_hash, log_index, chain_id, block_time, detail, simulated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    crypto.randomUUID(),
    agreement.id,
    milestone.id,
    kind,
    result,
    milestone.amount_cents,
    who.fromWallet,
    who.toWallet,
    who.fromName,
    who.toName,
    txHash ?? null,
    logIndex ?? null,
    chainId ?? null,
    blockTime ?? null,
    detail,
    blockTime ?? isoNow(),
  );
}

function refreshStatus(db, agreementId, now) {
  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  if (!agreement || agreement.replaced_by || agreement.status === "draft") return;
  if (!agreement.client_accepted_at) {
    if (agreement.chain_agreement_id) {
      db.prepare("UPDATE agreements SET status = 'awaiting_acceptance', updated_at = ? WHERE id = ?").run(now, agreementId);
    }
    return;
  }
  const phases = db.prepare("SELECT phase FROM milestones WHERE agreement_id = ? ORDER BY position").all(agreementId).map((row) => row.phase);
  let status = "active";
  if (phases.length > 0 && phases.every((phase) => phase === "refunded")) status = "cancelled";
  else if (phases.length > 0 && phases.every((phase) => phase === "paid" || phase === "refunded")) status = "completed";
  db.prepare("UPDATE agreements SET status = ?, updated_at = ? WHERE id = ?").run(status, now, agreementId);
}

function applyMilestoneRead(db, agreement, index, step, now) {
  const milestone = milestoneAt(db, agreement.id, index);
  if (!milestone) return;
  const phase = PHASES[Number(step.phase)] ?? "unfunded";
  const proposer = step.cancelProposer && step.cancelProposer.toLowerCase() !== zeroAddress ? step.cancelProposer.toLowerCase() : null;
  const nonce = Number(step.cancelNonce);
  let base = milestone.base_phase;
  if (proposer && HELD.has(phase)) base = base || phase;
  if (!proposer) base = null;
  const note = proposer ? (milestone.cancel_note || milestone.cancel_draft_note || "") : null;
  const proposedAt = proposer ? (milestone.cancel_proposed_at || now) : null;
  db.prepare(`
    UPDATE milestones SET
      phase = ?, submission_ref = ?, cancel_proposer = ?, cancel_nonce = ?, cancel_note = ?,
      cancel_draft_note = CASE WHEN ? IS NULL THEN NULL ELSE cancel_draft_note END,
      base_phase = ?, cancel_proposed_at = ?,
      funded_at = CASE WHEN ? = 'funded' AND funded_at IS NULL THEN ? ELSE funded_at END,
      paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN ? ELSE paid_at END,
      refunded_at = CASE WHEN ? = 'refunded' AND refunded_at IS NULL THEN ? ELSE refunded_at END
    WHERE id = ?
  `).run(
    phase,
    step.submissionRef && step.submissionRef !== `0x${"0".repeat(64)}` ? step.submissionRef : milestone.submission_ref,
    proposer,
    nonce,
    note,
    proposer,
    base,
    proposedAt,
    phase, now,
    phase, now,
    phase, now,
    milestone.id,
  );
  if (step.submissionRef) {
    db.prepare("UPDATE submissions SET status = 'confirmed' WHERE milestone_id = ? AND ref_hash = ? AND status = 'pending'").run(milestone.id, step.submissionRef);
  }
  if (phase === "changes_requested") {
    db.prepare("UPDATE revisions SET status = 'confirmed' WHERE milestone_id = ? AND status = 'pending'").run(milestone.id);
  }
}

function linkCreated(db, config, args, txHash, blockTime) {
  const attempt = db.prepare("SELECT * FROM tx_attempts WHERE lower(tx_hash) = lower(?) ORDER BY created_at DESC").get(txHash);
  let agreement = attempt?.agreement_id ? db.prepare("SELECT * FROM agreements WHERE id = ?").get(attempt.agreement_id) : null;
  if (!agreement) {
    const matches = db.prepare(`
      SELECT * FROM agreements
      WHERE chain_agreement_id IS NULL AND freelancer_wallet = ? AND client_wallet = ? AND terms_hash = ?
    `).all(args.freelancer.toLowerCase(), args.client.toLowerCase(), args.termsHash.toLowerCase());
    if (matches.length === 1) agreement = matches[0];
  }
  if (!agreement) return;
  if (!sameAddress(agreement.freelancer_wallet, args.freelancer) || !sameAddress(agreement.client_wallet, args.client)) return;
  if (agreement.terms_hash && agreement.terms_hash.toLowerCase() !== String(args.termsHash).toLowerCase()) return;
  db.prepare(`
    UPDATE agreements SET
      status = CASE WHEN status = 'draft' THEN 'awaiting_acceptance' ELSE status END,
      chain_id = ?, chain_agreement_id = ?, shared_at = COALESCE(shared_at, ?),
      freelancer_accepted_at = COALESCE(freelancer_accepted_at, ?), terms_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(config.chainId, String(args.id), blockTime, blockTime, String(args.termsHash).toLowerCase(), blockTime, agreement.id);
}

export function applyDecodedEvent(db, config, decoded, log, blockTime, txHash) {
  const args = decoded.args;
  const now = blockTime;
  if (decoded.eventName === "AgreementCreated") {
    linkCreated(db, config, args, txHash, blockTime);
    return;
  }
  const agreement = db.prepare("SELECT * FROM agreements WHERE chain_agreement_id = ?").get(String(args.id));
  if (!agreement) return;
  const index = Number(args.index ?? 0);
  const milestone = decoded.eventName === "AgreementAccepted" ? null : milestoneAt(db, agreement.id, index);
  if (decoded.eventName === "AgreementAccepted") {
    if (agreement.terms_hash && agreement.terms_hash.toLowerCase() !== String(args.termsHash).toLowerCase()) return;
    db.prepare("UPDATE agreements SET client_accepted_at = COALESCE(client_accepted_at, ?), status = 'active', updated_at = ? WHERE id = ?").run(blockTime, blockTime, agreement.id);
    refreshStatus(db, agreement.id, now);
    return;
  }
  if (!milestone) return;
  if (decoded.eventName === "MilestoneFunded") {
    const cents = baseUnitsToCents(args.amount);
    if (cents !== milestone.amount_cents) return;
    db.prepare("UPDATE milestones SET phase = 'funded', funded_at = COALESCE(funded_at, ?) WHERE id = ?").run(blockTime, milestone.id);
    insertLedger(db, agreement, milestone, "fund", "confirmed", "Deposited into escrow. This is not a payment to the freelancer.", txHash, log.logIndex, config.chainId, blockTime);
  } else if (decoded.eventName === "WorkSubmitted") {
    db.prepare("UPDATE milestones SET phase = 'submitted', submission_ref = ?, cancel_proposer = NULL, base_phase = NULL WHERE id = ?").run(args.submissionRef, milestone.id);
    db.prepare("UPDATE submissions SET status = 'confirmed', tx_hash = ? WHERE milestone_id = ? AND ref_hash = ?").run(txHash, milestone.id, args.submissionRef);
  } else if (decoded.eventName === "ChangesRequested") {
    db.prepare("UPDATE milestones SET phase = 'changes_requested', cancel_proposer = NULL, base_phase = NULL WHERE id = ?").run(milestone.id);
    db.prepare("UPDATE revisions SET status = 'confirmed', tx_hash = ? WHERE id = (SELECT id FROM revisions WHERE milestone_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1)").run(txHash, milestone.id);
  } else if (decoded.eventName === "MilestonePaid") {
    const cents = baseUnitsToCents(args.amount);
    if (cents !== milestone.amount_cents) return;
    db.prepare("UPDATE milestones SET phase = 'paid', paid_at = COALESCE(paid_at, ?), cancel_proposer = NULL, base_phase = NULL WHERE id = ?").run(blockTime, milestone.id);
    insertLedger(db, agreement, milestone, "release", "confirmed", "Paid in full to the freelancer, once.", txHash, log.logIndex, config.chainId, blockTime);
  } else if (decoded.eventName === "CancelProposed") {
    const fresh = milestoneAt(db, agreement.id, index);
    const base = fresh.base_phase || (HELD.has(fresh.phase) ? fresh.phase : "funded");
    db.prepare(`
      UPDATE milestones SET cancel_proposer = ?, cancel_nonce = ?, cancel_note = COALESCE(cancel_draft_note, cancel_note, ''),
        cancel_proposed_at = COALESCE(cancel_proposed_at, ?), base_phase = ? WHERE id = ?
    `).run(args.proposer.toLowerCase(), Number(args.nonce), blockTime, base, milestone.id);
  } else if (decoded.eventName === "CancelWithdrawn") {
    db.prepare("UPDATE milestones SET cancel_proposer = NULL, cancel_nonce = ?, cancel_note = NULL, cancel_draft_note = NULL, base_phase = NULL, cancel_proposed_at = NULL WHERE id = ?").run(Number(args.nonce), milestone.id);
  } else if (decoded.eventName === "MilestoneRefunded") {
    const cents = baseUnitsToCents(args.amount);
    if (cents !== milestone.amount_cents) return;
    db.prepare("UPDATE milestones SET phase = 'refunded', refunded_at = COALESCE(refunded_at, ?), cancel_proposer = NULL, cancel_note = NULL, base_phase = NULL, cancel_nonce = ? WHERE id = ?").run(blockTime, Number(args.nonce) + 1, milestone.id);
    insertLedger(db, agreement, milestone, "refund", "confirmed", "Both people agreed to this cancellation. The full amount went back to the client.", txHash, log.logIndex, config.chainId, blockTime);
  }
  refreshStatus(db, agreement.id, now);
}

export async function reconcileTransaction(db, client, config, txHash) {
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|could not be found/i.test(message)) return { status: "pending" };
    return { status: "unknown", detail: "The network did not answer. This is not proof the transaction failed." };
  }
  if (!receipt) return { status: "pending" };
  if (receipt.status !== "success") return { status: "reverted" };
  let blockTime = isoNow();
  try {
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    blockTime = new Date(Number(block.timestamp) * 1000).toISOString();
  } catch {
    blockTime = isoNow();
  }
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, config.escrow)) continue;
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      applyDecodedEvent(db, config, decoded, log, blockTime, txHash);
    } catch {
      continue;
    }
  }
  return { status: "confirmed", blockTime };
}

export async function overlayChain(db, client, config) {
  const rows = db.prepare("SELECT * FROM agreements WHERE chain_agreement_id IS NOT NULL AND replaced_by IS NULL").all();
  for (const agreement of rows) {
    const onchain = await client.readContract({
      address: config.escrow,
      abi: escrowAbi,
      functionName: "agreement",
      args: [BigInt(agreement.chain_agreement_id)],
    });
    const now = isoNow();
    if (onchain.clientAccepted && !agreement.client_accepted_at) {
      db.prepare("UPDATE agreements SET client_accepted_at = ?, updated_at = ? WHERE id = ?").run(now, now, agreement.id);
    }
    const count = Number(onchain.milestoneCount);
    for (let index = 0; index < count; index += 1) {
      const step = await client.readContract({
        address: config.escrow,
        abi: escrowAbi,
        functionName: "milestone",
        args: [BigInt(agreement.chain_agreement_id), BigInt(index)],
      });
      applyMilestoneRead(db, agreement, index, step, now);
    }
    refreshStatus(db, agreement.id, now);
  }
}
