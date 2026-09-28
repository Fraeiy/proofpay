import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { getAddress, isAddress, verifyMessage } from "viem";
import { centsToBaseUnits, checksum, hashTerms, sameAddress, SIGN_IN_STATEMENT, submissionRef } from "../shared/protocol.mjs";
import { makePublicClient, overlayChain, reconcileTransaction } from "./chain.mjs";
import { openDatabase } from "./db.mjs";
import { buildReceiptPdf } from "./receipt.mjs";

const PHASES = new Set(["unfunded", "funded", "submitted", "changes_requested", "paid", "refunded"]);
const HELD = new Set(["funded", "submitted", "changes_requested"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function shortWallet(wallet) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function parseCents(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n || cents > 100_000_000_00n) return null;
  return Number(cents);
}

function centsLabel(cents) {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${fraction}`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildSignInMessage({ domain, address, uri, chainId, nonce, issuedAt, expirationTime }) {
  return `${domain} wants you to sign in with your Ethereum account:
${address}

${SIGN_IN_STATEMENT}

URI: ${uri}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`;
}

function readCookie(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

export function createApp(options = {}) {
  const db = options.db ?? openDatabase(options.dataFile ?? ":memory:");
  const origins = new Set(options.origins ?? ["http://127.0.0.1:5174", "http://localhost:5174"]);
  const now = () => (options.now ? options.now() : new Date());
  const chain = options.chain ?? {
    chainId: 10143,
    rpcUrl: "https://testnet-rpc.monad.xyz",
    escrow: "",
    token: "",
    explorer: "https://testnet.monadvision.com",
    name: "Monad Testnet",
  };
  const allowedChains = new Set(options.allowedChainIds ?? [10143, 31337]);
  const challengeMs = options.challengeMs ?? 10 * 60 * 1000;
  const sessionMs = options.sessionMs ?? 7 * 24 * 60 * 60 * 1000;
  const limit = options.rateLimit ?? 20;
  const windowMs = options.rateWindowMs ?? 10 * 60 * 1000;
  const hits = new Map();
  const client = chain.escrow && chain.rpcUrl ? makePublicClient(chain.rpcUrl, chain.chainId) : null;

  function limited(key) {
    const at = now().getTime();
    const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(at);
    hits.set(key, recent);
    return true;
  }

  function originOf(req) {
    const origin = req.headers.origin;
    if (!origin) return null;
    if (origins.has(origin)) return origin;
    const forwarded = req.headers["x-forwarded-host"] || req.headers.host || "";
    const host = String(forwarded).split(",")[0].trim();
    try {
      if (host && new URL(origin).host === host) return origin;
    } catch {
      return null;
    }
    return null;
  }

  function sessionUser(req) {
    const token = readCookie(req.headers.cookie, "proofpay_session");
    if (!token) return null;
    const row = db.prepare("SELECT sessions.expires_at, users.* FROM sessions JOIN users ON users.wallet = sessions.wallet WHERE sessions.token_hash = ?").get(sha256(token));
    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= now().getTime()) return { expired: true };
    return row;
  }

  function send(res, status, body, extra = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-credentials": "true",
      ...extra,
    });
    res.end(payload);
  }

  function cookie(token, maxAge) {
    const secure = options.secureCookie ? "; Secure" : "";
    return `proofpay_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  function publicUser(row) {
    return {
      wallet: getAddress(row.wallet),
      displayName: row.display_name,
      intent: row.intent,
      preferredView: row.preferred_view,
      theme: row.theme,
      onboarded: row.onboarded === 1,
    };
  }

  function requireUser(req, res) {
    const user = sessionUser(req);
    if (!user) {
      send(res, 401, { error: "Sign in to continue." });
      return null;
    }
    if (user.expired) {
      send(res, 401, { error: "Your session expired. Sign in again." });
      return null;
    }
    return user;
  }

  function guardWrite(req, res) {
    if (!originOf(req) || req.headers["x-proofpay-request"] !== "1") {
      send(res, 403, { error: "This request did not come from the ProofPay site." });
      return false;
    }
    return true;
  }

  function agreementFor(id) {
    return db.prepare("SELECT * FROM agreements WHERE id = ?").get(id);
  }

  function canSee(user, agreement) {
    if (!agreement || !user) return false;
    if (sameAddress(agreement.freelancer_wallet, user.wallet)) return true;
    return sameAddress(agreement.client_wallet, user.wallet) && agreement.status !== "draft";
  }

  function loadAgreement(user, id, res) {
    const agreement = agreementFor(id);
    if (!canSee(user, agreement)) {
      send(res, 404, { error: "This agreement is private." });
      return null;
    }
    return agreement;
  }

  function mapMilestone(row, agreement) {
    const deliverableText = JSON.parse(row.deliverables_json);
    const submissions = db.prepare("SELECT * FROM submissions WHERE milestone_id = ? AND status = 'confirmed' ORDER BY created_at ASC").all(row.id);
    const revisions = db.prepare("SELECT * FROM revisions WHERE milestone_id = ? AND status != 'abandoned' ORDER BY created_at ASC").all(row.id);
    const held = HELD.has(row.phase);
    const proposed = Boolean(row.cancel_proposer) && held;
    return {
      id: row.id,
      title: row.title,
      deliverables: deliverableText.map((text, index) => ({ id: `${row.id}_d${index + 1}`, text })),
      amount: row.amount_cents,
      dueDate: row.due_date,
      phase: proposed ? "cancellation_proposed" : row.phase,
      fundedAt: row.funded_at ?? undefined,
      paidAt: row.paid_at ?? undefined,
      refundedAt: row.refunded_at ?? undefined,
      submissions: submissions.map((item) => ({
        id: item.id,
        note: item.note,
        links: JSON.parse(item.links_json),
        submittedAt: item.created_at,
        pending: item.status === "pending",
      })),
      revisionRequests: revisions.filter((item) => item.status === "confirmed" || item.tx_hash).map((item) => ({
        id: item.id,
        submissionId: item.submission_id ?? submissions[0]?.id ?? "",
        reason: item.reason,
        requestedAt: item.created_at,
      })),
      cancellation: proposed
        ? {
            id: String(row.cancel_nonce),
            proposedBy: sameAddress(row.cancel_proposer, agreement.client_wallet) ? "client" : "freelancer",
            note: row.cancel_note || "",
            proposedAt: row.cancel_proposed_at || agreement.updated_at,
            basePhase: row.base_phase || row.phase,
          }
        : undefined,
    };
  }

  function mapAgreement(row) {
    const milestones = db.prepare("SELECT * FROM milestones WHERE agreement_id = ? ORDER BY position ASC").all(row.id);
    const draft = row.status === "draft"
      ? {
          title: row.title,
          clientName: row.client_name,
          clientWallet: getAddress(row.client_wallet),
          description: row.description,
          milestones: milestones.map((milestone) => ({
            id: milestone.id,
            title: milestone.title,
            deliverables: JSON.parse(milestone.deliverables_json),
            amount: (milestone.amount_cents / 100).toFixed(2),
            dueDate: milestone.due_date,
          })),
        }
      : null;
    const freelancer = db.prepare("SELECT display_name FROM users WHERE wallet = ?").get(row.freelancer_wallet);
    const clientUser = db.prepare("SELECT display_name FROM users WHERE wallet = ?").get(row.client_wallet);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status === "cancelled" && row.replaced_by ? "cancelled" : row.status,
      freelancer: { name: freelancer?.display_name || "Freelancer", role: "freelancer", wallet: getAddress(row.freelancer_wallet) },
      client: { name: clientUser?.display_name || row.client_name, role: "client", wallet: getAddress(row.client_wallet) },
      termsRef: row.terms_hash || "draft",
      chainAgreementId: row.chain_agreement_id ?? undefined,
      freelancerAcceptedAt: row.freelancer_accepted_at ?? undefined,
      clientAcceptedAt: row.client_accepted_at ?? undefined,
      sharedAt: row.shared_at ?? undefined,
      createdAt: row.created_at,
      milestones: milestones.map((milestone) => mapMilestone(milestone, row)),
      draft,
    };
  }

  function mapLedger(row) {
    const explorer = row.result === "confirmed" && row.tx_hash && chain.explorer && !row.simulated
      ? `${chain.explorer.replace(/\/$/, "")}/tx/${row.tx_hash}`
      : undefined;
    return {
      id: row.id,
      agreementId: row.agreement_id,
      milestoneId: row.milestone_id,
      kind: row.kind,
      result: row.result,
      amount: row.amount_cents,
      fromName: row.from_name,
      fromWallet: checksum(row.from_wallet) || row.from_wallet,
      toName: row.to_name,
      toWallet: checksum(row.to_wallet) || row.to_wallet,
      at: row.block_time || row.created_at,
      reference: row.tx_hash || row.id,
      simulated: row.simulated === 1,
      detail: row.detail,
      txHash: row.tx_hash ?? undefined,
      chainId: row.chain_id ?? undefined,
      logIndex: row.log_index ?? undefined,
      explorerUrl: explorer,
    };
  }

  function visibleAgreements(user) {
    return db.prepare(`
      SELECT * FROM agreements
      WHERE freelancer_wallet = ? OR (client_wallet = ? AND status != 'draft')
      ORDER BY updated_at DESC
    `).all(user.wallet, user.wallet);
  }

  async function syncChain() {
    if (!client || !chain.escrow) return "unconfigured";
    try {
      const pending = db.prepare("SELECT DISTINCT tx_hash FROM tx_attempts WHERE status IN ('submitted', 'pending', 'unknown') AND tx_hash IS NOT NULL").all();
      for (const row of pending) {
        const result = await reconcileTransaction(db, client, chain, row.tx_hash);
        db.prepare("UPDATE tx_attempts SET status = ?, detail = ?, updated_at = ? WHERE tx_hash = ?").run(result.status, result.detail ?? null, now().toISOString(), row.tx_hash);
        if (result.status === "reverted") markReverted(row.tx_hash, result);
      }
      await overlayChain(db, client, chain);
      return "ok";
    } catch {
      return "unavailable";
    }
  }

  function markReverted(txHash, result) {
    const attempt = db.prepare("SELECT * FROM tx_attempts WHERE tx_hash = ?").get(txHash);
    if (!attempt?.agreement_id || !attempt.milestone_id) return;
    const agreement = agreementFor(attempt.agreement_id);
    const milestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(attempt.milestone_id);
    if (!agreement || !milestone) return;
    const existing = db.prepare("SELECT id FROM ledger WHERE tx_hash = ? AND result = 'failed'").get(txHash);
    if (existing) return;
    db.prepare(`
      INSERT INTO ledger (
        id, agreement_id, milestone_id, kind, result, amount_cents, from_wallet, to_wallet, from_name, to_name,
        tx_hash, chain_id, detail, simulated, created_at
      ) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      randomUUID(), agreement.id, milestone.id, attempt.purpose === "release" ? "release" : attempt.purpose === "refund" ? "refund" : "fund",
      milestone.amount_cents, agreement.client_wallet, agreement.freelancer_wallet, agreement.client_name, "Freelancer",
      txHash, chain.chainId, "The transaction reverted. Balances on the agreement are unchanged.", now().toISOString(),
    );
    void result;
  }

  function validateForm(user, form) {
    const errors = {};
    const title = String(form?.title ?? "").trim();
    const clientName = String(form?.clientName ?? "").trim();
    const description = String(form?.description ?? "").trim();
    const clientWallet = checksum(String(form?.clientWallet ?? "").trim());
    if (title.length < 3 || title.length > 80) errors.title = "Give the agreement a title, 3 to 80 characters.";
    if (clientName.length < 2 || clientName.length > 60) errors.clientName = "Add the client’s name, 2 to 60 characters.";
    if (!clientWallet) errors.clientWallet = "Enter the client’s wallet address.";
    else if (sameAddress(clientWallet, user.wallet)) errors.clientWallet = "Use a different wallet for the client. One person cannot be both sides of this agreement.";
    if (description.length < 20 || description.length > 600) errors.description = "Describe the work in 20 to 600 characters.";
    const milestones = Array.isArray(form?.milestones) ? form.milestones : [];
    if (milestones.length < 1 || milestones.length > 8) errors.milestones = "Add between 1 and 8 milestones.";
    const earliestDate = new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const normalized = [];
    milestones.forEach((milestone, index) => {
      const label = String(milestone?.title ?? "").trim();
      const due = String(milestone?.dueDate ?? "");
      const deliverables = Array.isArray(milestone?.deliverables) ? milestone.deliverables.map((line) => String(line).trim()).filter(Boolean) : [];
      const amount = parseCents(milestone?.amount);
      if (label.length < 2) errors[`milestone.${index}.title`] = "Name this milestone.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < earliestDate) errors[`milestone.${index}.dueDate`] = "Choose today or a later date.";
      if (deliverables.length < 1 || deliverables.length > 8) errors[`milestone.${index}.deliverables`] = "Add 1 to 8 deliverables.";
      if (amount == null) errors[`milestone.${index}.amount`] = "Enter an amount like 420.00.";
      normalized.push({
        id: String(milestone?.id || randomUUID()),
        title: label,
        deliverables,
        amountCents: amount ?? 0,
        dueDate: due,
        amount: String(milestone?.amount ?? ""),
      });
    });
    return { errors, title, clientName, clientWallet, description, milestones: normalized };
  }

  function replaceMilestones(agreementId, milestones) {
    db.prepare("DELETE FROM submissions WHERE milestone_id IN (SELECT id FROM milestones WHERE agreement_id = ?)").run(agreementId);
    db.prepare("DELETE FROM revisions WHERE milestone_id IN (SELECT id FROM milestones WHERE agreement_id = ?)").run(agreementId);
    db.prepare("DELETE FROM milestones WHERE agreement_id = ?").run(agreementId);
    const insert = db.prepare(`
      INSERT INTO milestones (
        id, agreement_id, position, title, deliverables_json, amount_cents, due_date, phase, cancel_nonce
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unfunded', 0)
    `);
    milestones.forEach((milestone, position) => {
      insert.run(milestone.id, agreementId, position, milestone.title, JSON.stringify(milestone.deliverables), milestone.amountCents, milestone.dueDate);
    });
  }

  function recordAttempt(user, body, status, detail) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO tx_attempts (id, wallet, agreement_id, milestone_id, purpose, tx_hash, status, detail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, user.wallet, body.agreementId ?? null, body.milestoneId ?? null, body.purpose, body.txHash ?? null, status, detail ?? null, now().toISOString(), now().toISOString());
    return id;
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-credentials", "true");
      res.setHeader("access-control-allow-headers", "content-type, x-proofpay-request");
      res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        send(res, 200, { ok: true, chainConfigured: Boolean(chain.escrow && chain.token) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/config") {
        send(res, 200, {
          chainId: chain.chainId,
          chainName: chain.name,
          rpcUrl: chain.rpcUrl,
          escrow: chain.escrow || null,
          token: chain.token || null,
          explorer: chain.explorer || null,
          tokenSymbol: "tUSDC",
          tokenName: "ProofPay Test Token",
          tokenDecimals: 6,
          nativeSymbol: "MON",
          configured: Boolean(chain.escrow && chain.token),
          testnet: true,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/challenge") {
        if (!guardWrite(req, res)) return;
        const ip = req.socket.remoteAddress ?? "local";
        if (!limited(`challenge:${ip}`)) {
          send(res, 429, { error: "Too many sign-in attempts. Wait a few minutes and try again." });
          return;
        }
        const body = await readBody(req);
        const address = checksum(body.address);
        const chainId = Number(body.chainId);
        if (!address) {
          send(res, 400, { error: "Enter a valid wallet address." });
          return;
        }
        if (!allowedChains.has(chainId)) {
          send(res, 400, { error: "Sign in on Monad testnet, or on the local test chain when you are running one." });
          return;
        }
        const site = originOf(req);
        const domain = new URL(site).host;
        const issuedAt = now().toISOString();
        const expiration = new Date(now().getTime() + challengeMs).toISOString();
        const nonce = randomBytes(16).toString("hex");
        const message = buildSignInMessage({ domain, address, uri: site, chainId, nonce, issuedAt, expirationTime: expiration });
        db.prepare(`
          INSERT INTO challenges (id, nonce, wallet, domain, uri, chain_id, message, issued_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), nonce, address.toLowerCase(), domain, site, chainId, message, issuedAt, expiration);
        send(res, 200, { message, expiresAt: expiration });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/verify") {
        if (!guardWrite(req, res)) return;
        const ip = req.socket.remoteAddress ?? "local";
        if (!limited(`verify:${ip}`)) {
          send(res, 429, { error: "Too many sign-in attempts. Wait a few minutes and try again." });
          return;
        }
        const body = await readBody(req);
        const message = String(body.message ?? "");
        const signature = String(body.signature ?? "");
        const row = db.prepare("SELECT * FROM challenges WHERE message = ?").get(message);
        if (!row) {
          send(res, 400, { error: "This sign-in challenge is invalid. Request a new one." });
          return;
        }
        if (row.consumed_at) {
          send(res, 400, { error: "This sign-in challenge was already used. Request a new one." });
          return;
        }
        if (new Date(row.expires_at).getTime() <= now().getTime()) {
          send(res, 400, { error: "This sign-in challenge expired. Request a new one." });
          return;
        }
        const site = originOf(req);
        if (!site || new URL(site).host !== row.domain || site !== row.uri) {
          send(res, 400, { error: "This sign-in message was issued for a different site." });
          return;
        }
        if (!message.includes(SIGN_IN_STATEMENT) || !allowedChains.has(row.chain_id)) {
          send(res, 400, { error: "This sign-in message does not match ProofPay’s chain policy." });
          return;
        }
        const valid = await verifyMessage({ address: getAddress(row.wallet), message, signature });
        if (!valid) {
          send(res, 400, { error: "The wallet signature was rejected. No session was created." });
          return;
        }
        const consumed = db.prepare("UPDATE challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(now().toISOString(), row.id);
        if (Number(consumed.changes) !== 1) {
          send(res, 400, { error: "This sign-in challenge was already used. Request a new one." });
          return;
        }
        const existing = db.prepare("SELECT * FROM users WHERE wallet = ?").get(row.wallet);
        if (!existing) {
          db.prepare(`
            INSERT INTO users (wallet, display_name, intent, preferred_view, theme, onboarded, created_at, updated_at)
            VALUES (?, ?, 'both', 'freelancer', 'system', 0, ?, ?)
          `).run(row.wallet, shortWallet(getAddress(row.wallet)), now().toISOString(), now().toISOString());
        }
        const token = randomBytes(32).toString("hex");
        const expires = new Date(now().getTime() + sessionMs).toISOString();
        db.prepare("INSERT INTO sessions (id, wallet, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), row.wallet, sha256(token), expires, now().toISOString());
        const user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(row.wallet);
        send(res, 200, { user: publicUser(user) }, { "set-cookie": cookie(token, Math.floor(sessionMs / 1000)) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        if (!guardWrite(req, res)) return;
        const token = readCookie(req.headers.cookie, "proofpay_session");
        if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
        send(res, 200, { ok: true }, { "set-cookie": cookie("", 0) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/auth/session") {
        if (req.headers["x-proofpay-request"] !== "1") {
          send(res, 403, { error: "This request did not come from the ProofPay site." });
          return;
        }
        const user = sessionUser(req);
        if (!user || user.expired) {
          send(res, 200, { user: null, expired: Boolean(user?.expired) });
          return;
        }
        send(res, 200, { user: publicUser(user) });
        return;
      }
      if (req.method === "PATCH" && url.pathname === "/api/me") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const body = await readBody(req);
        const displayName = String(body.displayName ?? user.display_name).trim();
        const intent = body.intent ?? user.intent;
        const preferredView = body.preferredView ?? user.preferred_view;
        const theme = body.theme ?? user.theme;
        const onboarded = body.onboarded == null ? user.onboarded : body.onboarded ? 1 : 0;
        if (displayName.length < 2 || displayName.length > 60) {
          send(res, 400, { error: "Use a display name between 2 and 60 characters." });
          return;
        }
        if (!["freelance", "hire", "both"].includes(intent)) {
          send(res, 400, { error: "Choose what brings you here." });
          return;
        }
        if (!["freelancer", "client"].includes(preferredView)) {
          send(res, 400, { error: "Choose a starting view." });
          return;
        }
        if (!["light", "dark", "system"].includes(theme)) {
          send(res, 400, { error: "Choose light, dark, or system." });
          return;
        }
        db.prepare("UPDATE users SET display_name = ?, intent = ?, preferred_view = ?, theme = ?, onboarded = ?, updated_at = ? WHERE wallet = ?").run(displayName, intent, preferredView, theme, onboarded, now().toISOString(), user.wallet);
        send(res, 200, { user: publicUser(db.prepare("SELECT * FROM users WHERE wallet = ?").get(user.wallet)) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/workspace") {
        if (req.headers["x-proofpay-request"] !== "1") {
          send(res, 403, { error: "This request did not come from the ProofPay site." });
          return;
        }
        const user = requireUser(req, res);
        if (!user) return;
        const chainSync = await syncChain();
        const agreements = visibleAgreements(user).map(mapAgreement);
        const ids = agreements.map((item) => item.id);
        const ledger = ids.length
          ? db.prepare(`SELECT * FROM ledger WHERE agreement_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`).all(...ids).map(mapLedger)
          : [];
        send(res, 200, { user: publicUser(user), agreements, ledger, chainSync, chain });
        return;
      }

      const agreementMatch = url.pathname.match(/^\/api\/agreements\/([^/]+)$/);
      if (agreementMatch && req.method === "GET") {
        if (req.headers["x-proofpay-request"] !== "1") {
          send(res, 403, { error: "This request did not come from the ProofPay site." });
          return;
        }
        const user = requireUser(req, res);
        if (!user) return;
        const agreement = loadAgreement(user, agreementMatch[1], res);
        if (!agreement) return;
        send(res, 200, { agreement: mapAgreement(agreement) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/agreements") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const body = await readBody(req);
        const parsed = validateForm(user, body);
        if (Object.keys(parsed.errors).length > 0 && body.strict) {
          send(res, 400, { error: "Check the agreement fields.", errors: parsed.errors });
          return;
        }
        if (!parsed.title || !parsed.clientWallet) {
          send(res, 400, { error: "Add a title and the client wallet before saving.", errors: parsed.errors });
          return;
        }
        const id = randomUUID();
        const at = now().toISOString();
        db.prepare(`
          INSERT INTO agreements (
            id, title, description, status, freelancer_wallet, client_wallet, client_name, terms_json, version, created_at, updated_at
          ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, 1, ?, ?)
        `).run(id, parsed.title, parsed.description, user.wallet, parsed.clientWallet.toLowerCase(), parsed.clientName, JSON.stringify(body), at, at);
        if (parsed.milestones.length) replaceMilestones(id, parsed.milestones);
        send(res, 200, { agreement: mapAgreement(agreementFor(id)) });
        return;
      }
      if (agreementMatch && req.method === "PATCH") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const agreement = loadAgreement(user, agreementMatch[1], res);
        if (!agreement) return;
        if (!sameAddress(agreement.freelancer_wallet, user.wallet) || agreement.status !== "draft") {
          send(res, 403, { error: "Accepted terms stay fixed. Create a new version before the client accepts, or leave this agreement as it is." });
          return;
        }
        const body = await readBody(req);
        const parsed = validateForm(user, body);
        if (!parsed.title || !parsed.clientWallet) {
          send(res, 400, { error: "Add a title and the client wallet before saving.", errors: parsed.errors });
          return;
        }
        db.prepare(`
          UPDATE agreements SET title = ?, description = ?, client_wallet = ?, client_name = ?, terms_json = ?, terms_hash = NULL, version = version + 1, updated_at = ?
          WHERE id = ?
        `).run(parsed.title, parsed.description, parsed.clientWallet.toLowerCase(), parsed.clientName, JSON.stringify(body), now().toISOString(), agreement.id);
        replaceMilestones(agreement.id, parsed.milestones);
        send(res, 200, { agreement: mapAgreement(agreementFor(agreement.id)) });
        return;
      }
      if (agreementMatch && req.method === "DELETE") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const agreement = loadAgreement(user, agreementMatch[1], res);
        if (!agreement) return;
        if (!sameAddress(agreement.freelancer_wallet, user.wallet) || agreement.status !== "draft") {
          send(res, 403, { error: "Only an unshared draft can be deleted." });
          return;
        }
        db.prepare("DELETE FROM milestones WHERE agreement_id = ?").run(agreement.id);
        db.prepare("DELETE FROM agreements WHERE id = ?").run(agreement.id);
        send(res, 200, { ok: true });
        return;
      }

      const revise = url.pathname.match(/^\/api\/agreements\/([^/]+)\/revise$/);
      if (revise && req.method === "POST") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const agreement = loadAgreement(user, revise[1], res);
        if (!agreement) return;
        if (!sameAddress(agreement.freelancer_wallet, user.wallet) || agreement.status !== "awaiting_acceptance") {
          send(res, 403, { error: "A new version is only for terms the client has not accepted." });
          return;
        }
        const funded = db.prepare("SELECT id FROM milestones WHERE agreement_id = ? AND phase != 'unfunded'").get(agreement.id);
        if (funded) {
          send(res, 409, { error: "Funded milestones cannot be replaced by a new draft." });
          return;
        }
        const id = randomUUID();
        const at = now().toISOString();
        db.prepare(`
          INSERT INTO agreements (
            id, title, description, status, freelancer_wallet, client_wallet, client_name, terms_json, version, created_at, updated_at
          ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
        `).run(id, agreement.title, agreement.description, agreement.freelancer_wallet, agreement.client_wallet, agreement.client_name, agreement.terms_json, agreement.version + 1, at, at);
        const milestones = db.prepare("SELECT * FROM milestones WHERE agreement_id = ? ORDER BY position").all(agreement.id);
        replaceMilestones(id, milestones.map((milestone) => ({
          id: randomUUID(),
          title: milestone.title,
          deliverables: JSON.parse(milestone.deliverables_json),
          amountCents: milestone.amount_cents,
          dueDate: milestone.due_date,
        })));
        db.prepare("UPDATE agreements SET status = 'cancelled', replaced_by = ?, updated_at = ? WHERE id = ?").run(id, at, agreement.id);
        send(res, 200, { agreement: mapAgreement(agreementFor(id)) });
        return;
      }

      const commit = url.pathname.match(/^\/api\/agreements\/([^/]+)\/commit$/);
      if (commit && req.method === "POST") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const agreement = loadAgreement(user, commit[1], res);
        if (!agreement) return;
        if (!sameAddress(agreement.freelancer_wallet, user.wallet) || agreement.status !== "draft") {
          send(res, 403, { error: "Only the freelancer can commit a draft." });
          return;
        }
        if (!chain.escrow) {
          send(res, 503, { error: "The escrow contract is not configured on this server yet. No agreement was committed." });
          return;
        }
        const form = JSON.parse(agreement.terms_json);
        const parsed = validateForm(user, form);
        if (Object.keys(parsed.errors).length > 0) {
          send(res, 400, { error: "Finish the agreement before sharing it.", errors: parsed.errors });
          return;
        }
        const termsHash = hashTerms({
          title: parsed.title,
          description: parsed.description,
          clientWallet: parsed.clientWallet,
          freelancerWallet: getAddress(user.wallet),
          milestones: parsed.milestones,
        });
        db.prepare("UPDATE agreements SET terms_hash = ?, updated_at = ? WHERE id = ?").run(termsHash.toLowerCase(), now().toISOString(), agreement.id);
        replaceMilestones(agreement.id, parsed.milestones);
        send(res, 200, {
          agreementId: agreement.id,
          escrow: chain.escrow,
          token: chain.token,
          chainId: chain.chainId,
          client: parsed.clientWallet,
          termsHash,
          amounts: parsed.milestones.map((milestone) => centsToBaseUnits(milestone.amountCents).toString()),
        });
        return;
      }

      const accept = url.pathname.match(/^\/api\/agreements\/([^/]+)\/accept$/);
      if (accept && req.method === "POST") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const agreement = loadAgreement(user, accept[1], res);
        if (!agreement) return;
        if (!sameAddress(agreement.client_wallet, user.wallet)) {
          send(res, 403, { error: "Only the designated client can accept these terms." });
          return;
        }
        if (agreement.status !== "awaiting_acceptance" || !agreement.chain_agreement_id || !agreement.terms_hash) {
          send(res, 409, { error: "The freelancer has not committed this version onchain yet." });
          return;
        }
        send(res, 200, {
          escrow: chain.escrow,
          chainId: chain.chainId,
          chainAgreementId: agreement.chain_agreement_id,
          termsHash: agreement.terms_hash,
        });
        return;
      }

      const submissionPath = url.pathname.match(/^\/api\/milestones\/([^/]+)\/submission$/);
      if (submissionPath && req.method === "POST") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const milestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(submissionPath[1]);
        const agreement = milestone ? agreementFor(milestone.agreement_id) : null;
        if (!agreement || !canSee(user, agreement)) {
          send(res, 404, { error: "This agreement is private." });
          return;
        }
        if (!sameAddress(agreement.freelancer_wallet, user.wallet)) {
          send(res, 403, { error: "Only the freelancer can submit work." });
          return;
        }
        if (!["funded", "changes_requested"].includes(milestone.phase) || milestone.cancel_proposer) {
          send(res, 409, { error: "Submit only while funds are held and no cancellation is open." });
          return;
        }
        const body = await readBody(req);
        const note = String(body.note ?? "").trim();
        const links = Array.isArray(body.links) ? body.links : [];
        if (note.length < 10 || note.length > 2000) {
          send(res, 400, { error: "Add an explanation of at least 10 characters." });
          return;
        }
        if (links.length < 1 || links.length > 6 || links.some((link) => String(link.label ?? "").trim().length < 1 || !isHttpUrl(String(link.url ?? "").trim()))) {
          send(res, 400, { error: "Each evidence link needs a label and an http(s) URL." });
          return;
        }
        db.prepare("UPDATE submissions SET status = 'abandoned' WHERE milestone_id = ? AND status = 'pending' AND tx_hash IS NULL").run(milestone.id);
        const id = randomUUID();
        const ref = submissionRef(id);
        const cleanLinks = links.map((link) => ({ id: randomUUID(), label: String(link.label).trim(), url: String(link.url).trim() }));
        db.prepare("INSERT INTO submissions (id, milestone_id, note, links_json, ref_hash, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(id, milestone.id, note, JSON.stringify(cleanLinks), ref, now().toISOString());
        send(res, 200, {
          submissionId: id,
          ref,
          escrow: chain.escrow,
          chainId: chain.chainId,
          chainAgreementId: agreement.chain_agreement_id,
          index: milestone.position,
        });
        return;
      }

      const abandon = url.pathname.match(/^\/api\/submissions\/([^/]+)\/abandon$/);
      if (abandon && req.method === "POST") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(abandon[1]);
        const milestone = submission ? db.prepare("SELECT * FROM milestones WHERE id = ?").get(submission.milestone_id) : null;
        const agreement = milestone ? agreementFor(milestone.agreement_id) : null;
        if (!agreement || !sameAddress(agreement.freelancer_wallet, user.wallet)) {
          send(res, 404, { error: "This agreement is private." });
          return;
        }
        if (submission.status === "pending") {
          db.prepare("UPDATE submissions SET status = 'abandoned' WHERE id = ?").run(submission.id);
        }
        send(res, 200, { ok: true });
        return;
      }

      const changes = url.pathname.match(/^\/api\/milestones\/([^/]+)\/changes$/);
      if (changes && req.method === "POST") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const milestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(changes[1]);
        const agreement = milestone ? agreementFor(milestone.agreement_id) : null;
        if (!agreement || !canSee(user, agreement)) {
          send(res, 404, { error: "This agreement is private." });
          return;
        }
        if (!sameAddress(agreement.client_wallet, user.wallet)) {
          send(res, 403, { error: "Only the client can request changes." });
          return;
        }
        if (milestone.phase !== "submitted") {
          send(res, 409, { error: "Changes can be requested after a submission, before payment." });
          return;
        }
        const body = await readBody(req);
        const reason = String(body.reason ?? "").trim();
        if (reason.length < 10 || reason.length > 2000) {
          send(res, 400, { error: "Explain what needs to change, in at least 10 characters." });
          return;
        }
        const latest = db.prepare("SELECT id FROM submissions WHERE milestone_id = ? AND status = 'confirmed' ORDER BY created_at DESC").get(milestone.id);
        const id = randomUUID();
        db.prepare("INSERT INTO revisions (id, milestone_id, submission_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(id, milestone.id, latest?.id ?? null, reason, now().toISOString());
        send(res, 200, { revisionId: id, escrow: chain.escrow, chainId: chain.chainId, chainAgreementId: agreement.chain_agreement_id, index: milestone.position });
        return;
      }

      const cancel = url.pathname.match(/^\/api\/milestones\/([^/]+)\/cancel$/);
      if (cancel && req.method === "POST") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const milestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(cancel[1]);
        const agreement = milestone ? agreementFor(milestone.agreement_id) : null;
        if (!agreement || !canSee(user, agreement)) {
          send(res, 404, { error: "This agreement is private." });
          return;
        }
        if (!sameAddress(agreement.client_wallet, user.wallet) && !sameAddress(agreement.freelancer_wallet, user.wallet)) {
          send(res, 403, { error: "Only the client or freelancer can propose cancellation." });
          return;
        }
        if (!HELD.has(milestone.phase) || !PHASES.has(milestone.phase)) {
          send(res, 409, { error: "Only an unpaid funded milestone can be cancelled, and only by agreement." });
          return;
        }
        const body = await readBody(req);
        const note = String(body.note ?? "").trim();
        if (note.length < 10) {
          send(res, 400, { error: "Explain the cancellation in at least 10 characters." });
          return;
        }
        db.prepare("UPDATE milestones SET cancel_draft_note = ? WHERE id = ?").run(note, milestone.id);
        send(res, 200, { escrow: chain.escrow, chainId: chain.chainId, chainAgreementId: agreement.chain_agreement_id, index: milestone.position, nonce: milestone.cancel_nonce });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tx") {
        if (!guardWrite(req, res)) return;
        const user = requireUser(req, res);
        if (!user) return;
        const body = await readBody(req);
        const purpose = String(body.purpose ?? "");
        if (!["create", "accept", "approve", "fund", "submit", "changes", "release", "propose", "withdraw", "refund"].includes(purpose)) {
          send(res, 400, { error: "Unknown transaction purpose." });
          return;
        }
        if (body.agreementId) {
          const agreement = agreementFor(body.agreementId);
          if (!canSee(user, agreement) && !(agreement && sameAddress(agreement.freelancer_wallet, user.wallet))) {
            send(res, 404, { error: "This agreement is private." });
            return;
          }
        }
        if (body.status === "rejected" || body.status === "unknown") {
          recordAttempt(user, body, body.status, body.detail ?? "");
          if (body.submissionId) db.prepare("UPDATE submissions SET status = 'abandoned' WHERE id = ? AND status = 'pending' AND tx_hash IS NULL").run(body.submissionId);
          if (body.agreementId && body.milestoneId && body.status === "rejected") {
            const milestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(body.milestoneId);
            const agreement = agreementFor(body.agreementId);
            if (milestone && agreement) {
              db.prepare(`
                INSERT INTO ledger (id, agreement_id, milestone_id, kind, result, amount_cents, from_wallet, to_wallet, from_name, to_name, detail, simulated, created_at)
                VALUES (?, ?, ?, ?, 'rejected', ?, ?, ?, ?, ?, ?, 0, ?)
              `).run(randomUUID(), agreement.id, milestone.id, purpose === "release" ? "release" : purpose === "refund" ? "refund" : "fund", milestone.amount_cents, agreement.client_wallet, agreement.freelancer_wallet, agreement.client_name, "Freelancer", "You rejected the wallet request. No funds moved.", now().toISOString());
            }
          }
          send(res, 200, { status: body.status });
          return;
        }
        const txHash = String(body.txHash ?? "");
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
          send(res, 400, { error: "A transaction hash is required before ProofPay can check the network." });
          return;
        }
        recordAttempt(user, { ...body, txHash }, "submitted", body.detail ?? "");
        if (body.submissionId) db.prepare("UPDATE submissions SET tx_hash = ? WHERE id = ?").run(txHash, body.submissionId);
        if (!client) {
          send(res, 200, { status: "unknown", detail: "The server has no RPC configured, so this transaction is not verified yet." });
          return;
        }
        const result = await reconcileTransaction(db, client, chain, txHash);
        db.prepare("UPDATE tx_attempts SET status = ?, detail = ?, updated_at = ? WHERE tx_hash = ?").run(result.status, result.detail ?? null, now().toISOString(), txHash);
        if (result.status === "reverted") markReverted(txHash);
        send(res, 200, result);
        return;
      }

      const receipt = url.pathname.match(/^\/api\/receipts\/([^/]+)\.pdf$/);
      if (receipt && req.method === "GET") {
        if (req.headers["x-proofpay-request"] !== "1") {
          send(res, 403, { error: "This request did not come from the ProofPay site." });
          return;
        }
        const user = requireUser(req, res);
        if (!user) return;
        const entry = db.prepare("SELECT * FROM ledger WHERE id = ?").get(receipt[1]);
        const agreement = entry ? agreementFor(entry.agreement_id) : null;
        if (!entry || !agreement || !canSee(user, agreement) || entry.simulated === 1 || entry.result !== "confirmed") {
          send(res, 404, { error: "This agreement is private." });
          return;
        }
        const milestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(entry.milestone_id);
        const heading = entry.kind === "fund" ? "Deposit confirmation" : entry.kind === "refund" ? "Refund confirmation" : "Payment receipt";
        const note = entry.kind === "fund"
          ? "This confirms a deposit into escrow. It is not a payment received by the freelancer."
          : entry.kind === "refund"
            ? "Both participants agreed to cancel this unpaid milestone. The full amount was refunded to the client."
            : "The client approved the submitted work. The full milestone amount was released to the freelancer once.";
        const bytes = await buildReceiptPdf({
          heading,
          status: "Confirmed on the test network",
          amountLabel: `${centsLabel(entry.amount_cents)} tUSDC`,
          reference: entry.id,
          agreementTitle: agreement.title,
          agreementRef: agreement.id,
          milestoneTitle: milestone?.title ?? "Milestone",
          fromName: entry.from_name,
          fromWallet: getAddress(entry.from_wallet),
          toName: entry.to_name,
          toWallet: getAddress(entry.to_wallet),
          token: "tUSDC · ProofPay Test Token · 6 decimals · no monetary value",
          network: `${chain.name} · chain ${chain.chainId}`,
          confirmedAt: entry.block_time || entry.created_at,
          txHash: entry.tx_hash,
          explorerUrl: entry.tx_hash && chain.explorer ? `${chain.explorer.replace(/\/$/, "")}/tx/${entry.tx_hash}` : "",
          note,
          sample: false,
        });
        res.writeHead(200, {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="proofpay-${entry.id}.pdf"`,
          "cache-control": "no-store",
        });
        res.end(Buffer.from(bytes));
        return;
      }

      send(res, 404, { error: "Not found." });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
      send(res, status, { error: status === 500 ? "ProofPay could not finish that request." : error.message });
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  return { server, db, handle, close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })) };
}
