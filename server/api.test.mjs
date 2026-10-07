import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "./app.mjs";

const ORIGIN = "http://127.0.0.1:5174";

async function boot(overrides = {}) {
  let clock = new Date("2026-09-28T12:00:00.000Z");
  const app = createApp({
    dataFile: ":memory:",
    now: () => new Date(clock.getTime()),
    origins: [ORIGIN],
    rateLimit: 30,
    chain: { chainId: 31337, rpcUrl: "http://127.0.0.1:1", escrow: "", token: "", explorer: "", name: "local" },
    ...overrides,
    now: overrides.now ?? (() => new Date(clock.getTime())),
  });
  if (overrides.now) clock = null;
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  app.server.unref();
  const { port } = app.server.address();
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    setClock(date) { clock = date; },
  };
}

function headers(cookie) {
  return {
    origin: ORIGIN,
    "content-type": "application/json",
    "x-proofpay-request": "1",
    ...(cookie ? { cookie } : {}),
  };
}

async function signIn(base, account, chainId = 31337) {
  const challenge = await fetch(`${base}/api/auth/challenge`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ address: account.address, chainId }),
  });
  const issued = await challenge.json();
  assert.equal(challenge.status, 200, issued.error);
  assert.match(issued.message, /does not move funds or approve token spending/);
  const signature = await account.signMessage({ message: issued.message });
  const verified = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: issued.message, signature }),
  });
  const body = await verified.json();
  const cookie = verified.headers.getSetCookie?.()[0]?.split(";")[0];
  return { status: verified.status, body, cookie, message: issued.message, signature };
}

function pdfPlainText(bytes) {
  const raw = bytes.toString("latin1");
  const pieces = [raw];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = Buffer.from(match[1] ?? "", "latin1");
    try {
      pieces.push(inflateSync(body).toString("latin1"));
    } catch {
      pieces.push(body.toString("latin1"));
    }
  }
  const joined = pieces.join("\n");
  return joined.replace(/<([0-9A-Fa-f\s]+)>/g, (token, hex) => {
    const compact = hex.replace(/\s+/g, "");
    if (compact.length < 4 || compact.length % 2 !== 0) return token;
    return Buffer.from(compact, "hex").toString("latin1");
  });
}

function account() {
  return privateKeyToAccount(generatePrivateKey());
}

const draft = (client) => ({
  title: "Weekly social management",
  clientName: "Northline Labs",
  clientWallet: client,
  description: "Four weeks of social posts, community replies, and a Friday activity report.",
  milestones: [{
    id: "ms_week",
    title: "Week 1",
    deliverables: ["Five posts"],
    amount: "420.00",
    dueDate: "2026-10-07",
  }],
});

test("rejects a replayed sign-in and an expired challenge", async () => {
  const { app, base, setClock } = await boot();
  const wallet = account();
  const first = await signIn(base, wallet);
  assert.equal(first.status, 200);
  const replay = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: first.message, signature: first.signature }),
  });
  const replayed = await replay.json();
  assert.equal(replay.status, 400);
  assert.match(replayed.error, /already used/);

  setClock(new Date("2026-09-28T12:00:00.000Z"));
  const challenge = await fetch(`${base}/api/auth/challenge`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ address: wallet.address, chainId: 31337 }),
  });
  const issued = await challenge.json();
  setClock(new Date("2026-09-28T12:11:00.000Z"));
  const signature = await wallet.signMessage({ message: issued.message });
  const expired = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: issued.message, signature }),
  });
  assert.equal(expired.status, 400);
  assert.match((await expired.json()).error, /expired/);
  await app.close();
});

test("rejects a sign-in message for a different site or wallet", async () => {
  const { app, base } = await boot();
  const blocked = await fetch(`${base}/api/auth/challenge`, {
    method: "POST",
    headers: { ...headers(), origin: "https://evil.example" },
    body: JSON.stringify({ address: account().address, chainId: 31337 }),
  });
  assert.equal(blocked.status, 403);

  const wallet = account();
  const other = account();
  const challenge = await fetch(`${base}/api/auth/challenge`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ address: wallet.address, chainId: 31337 }),
  });
  const issued = await challenge.json();
  const tampered = issued.message.replace(new URL(ORIGIN).host, "evil.example");
  const signature = await wallet.signMessage({ message: tampered });
  const wrongSite = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: tampered, signature }),
  });
  assert.equal(wrongSite.status, 400);

  const foreign = await other.signMessage({ message: issued.message });
  const wrongWallet = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ message: issued.message, signature: foreign }),
  });
  assert.equal(wrongWallet.status, 400);
  assert.match((await wrongWallet.json()).error, /signature/);
  await app.close();
});

test("hides private agreements and ignores a client-supplied role", async () => {
  const { app, base } = await boot();
  const freelancer = account();
  const client = account();
  const stranger = account();
  const freelancerSession = await signIn(base, freelancer);
  const created = await fetch(`${base}/api/agreements`, {
    method: "POST",
    headers: headers(freelancerSession.cookie),
    body: JSON.stringify(draft(client.address)),
  });
  const { agreement } = await created.json();
  assert.equal(created.status, 200);

  const clientSession = await signIn(base, client);
  const hidden = await fetch(`${base}/api/agreements/${agreement.id}`, { headers: headers(clientSession.cookie) });
  const hiddenBody = await hidden.json();
  assert.equal(hidden.status, 404);
  assert.equal(hiddenBody.error, "This agreement is private.");
  assert.equal(hiddenBody.title, undefined);

  const strangerSession = await signIn(base, stranger);
  const denied = await fetch(`${base}/api/agreements/${agreement.id}`, { headers: headers(strangerSession.cookie) });
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).title, undefined);

  await fetch(`${base}/api/me`, {
    method: "PATCH",
    headers: headers(freelancerSession.cookie),
    body: JSON.stringify({ preferredView: "client", intent: "hire", displayName: "Amara Cole", onboarded: true }),
  });
  const accept = await fetch(`${base}/api/agreements/${agreement.id}/accept`, {
    method: "POST",
    headers: headers(freelancerSession.cookie),
    body: JSON.stringify({ role: "client" }),
  });
  assert.equal(accept.status, 403);

  app.db.prepare("UPDATE agreements SET status = 'awaiting_acceptance', chain_agreement_id = '1', terms_hash = '0xabc' WHERE id = ?").run(agreement.id);
  const submit = await fetch(`${base}/api/milestones/${agreement.milestones[0].id}/submission`, {
    method: "POST",
    headers: headers(clientSession.cookie),
    body: JSON.stringify({ role: "freelancer", note: "This should not be stored in the agreement.", links: [{ label: "Report", url: "https://example.com/report" }] }),
  });
  assert.equal(submit.status, 403);
  const after = await fetch(`${base}/api/agreements/${agreement.id}`, { headers: headers(freelancerSession.cookie) });
  const fresh = await after.json();
  assert.equal(fresh.agreement.milestones[0].submissions.length, 0);
  assert.equal(JSON.stringify(fresh).includes("should not be stored"), false);
  await app.close();
});

test("logout ends the session", async () => {
  const { app, base } = await boot();
  const session = await signIn(base, account());
  const goodbye = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: headers(session.cookie) });
  assert.equal(goodbye.status, 200);
  const again = await fetch(`${base}/api/workspace`, { headers: headers(session.cookie) });
  assert.equal(again.status, 401);
  await app.close();
});

test("rate limits sign-in challenges", async () => {
  const { app, base } = await boot({ rateLimit: 2 });
  try {
    const wallet = account();
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(`${base}/api/auth/challenge`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ address: wallet.address, chainId: 31337 }),
      });
      assert.equal(response.status, 200);
    }
    const blocked = await fetch(`${base}/api/auth/challenge`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ address: wallet.address, chainId: 31337 }),
    });
    assert.equal(blocked.status, 429);
  } finally {
    await app.close();
  }
});

test("an unverified hash is not a payment, and a receipt stays private", async () => {
  const { app, base } = await boot();
  try {
    const freelancer = account();
    const client = account();
    const stranger = account();
    const session = await signIn(base, freelancer);
    const created = await fetch(`${base}/api/agreements`, {
      method: "POST",
      headers: headers(session.cookie),
      body: JSON.stringify(draft(client.address)),
    });
    const { agreement } = await created.json();
    const milestone = agreement.milestones[0];
    const hash = `0x${"ab".repeat(32)}`;
    const reported = await fetch(`${base}/api/tx`, {
      method: "POST",
      headers: headers(session.cookie),
      body: JSON.stringify({ purpose: "release", agreementId: agreement.id, milestoneId: milestone.id, txHash: hash }),
    });
    const body = await reported.json();
    assert.equal(reported.status, 200);
    assert.equal(body.status, "unknown");
    const fresh = await fetch(`${base}/api/agreements/${agreement.id}`, { headers: headers(session.cookie) });
    const again = await fresh.json();
    assert.equal(again.agreement.milestones[0].phase, "unfunded");

    const receiptId = "rcpt_confirmed";
    app.db.prepare(`
      INSERT INTO ledger (
        id, agreement_id, milestone_id, kind, result, amount_cents,
        from_wallet, to_wallet, from_name, to_name, tx_hash, log_index, chain_id, block_time, detail, simulated, created_at
      ) VALUES (?, ?, ?, 'release', 'confirmed', ?, ?, ?, ?, ?, ?, 0, 31337, ?, ?, 0, ?)
    `).run(
      receiptId,
      agreement.id,
      milestone.id,
      42000,
      client.address.toLowerCase(),
      freelancer.address.toLowerCase(),
      "Northline Labs",
      "A very long display name that should wrap inside the receipt without colliding with the wallet line",
      hash,
      "2026-09-28T15:04:00.000Z",
      "Confirmed test payment for a long agreement title that keeps wrapping onto the next line of the record.",
      "2026-09-28T15:04:00.000Z",
    );
    const pdf = await fetch(`${base}/api/receipts/${receiptId}.pdf`, { headers: headers(session.cookie) });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-type") ?? "", /pdf/);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    const decoded = pdfPlainText(bytes);
    assert.match(decoded, /TESTNET PAYMENT/);
    assert.match(decoded, /not a tax invoice/);
    assert.match(decoded, /no explorer claim|Not available|monadvision|31337|ProofPay/);

    const strangerSession = await signIn(base, stranger);
    const hidden = await fetch(`${base}/api/receipts/${receiptId}.pdf`, { headers: headers(strangerSession.cookie) });
    assert.equal(hidden.status, 404);

    const open = await fetch(`${base}/api/receipts/${receiptId}.pdf`);
    assert.equal(open.status, 403);
  } finally {
    await app.close();
  }
});

test("invitation claim is single-use and does not grant funding", async () => {
  const { app, base } = await boot();
  const freelancer = account();
  const client = account();
  const stranger = account();
  const freelancerSession = await signIn(base, freelancer);
  const created = await fetch(`${base}/api/agreements`, {
    method: "POST",
    headers: headers(freelancerSession.cookie),
    body: JSON.stringify({ ...draft(client.address), clientWallet: "", invite: true }),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 200, createdBody.error);
  assert.equal(createdBody.agreement.client.wallet, "");

  const invited = await fetch(`${base}/api/agreements/${createdBody.agreement.id}/invitation`, {
    method: "POST",
    headers: headers(freelancerSession.cookie),
    body: "{}",
  });
  const invitation = await invited.json();
  assert.equal(invited.status, 200, invitation.error);
  assert.match(invitation.token, /^[a-f0-9]{64}$/);

  const preview = await fetch(`${base}/api/invitations/${invitation.token}`, { headers: headers() });
  const previewBody = await preview.json();
  assert.equal(preview.status, 200);
  assert.equal(previewBody.status, "open");
  assert.equal(previewBody.clientWallet, undefined);
  assert.equal(JSON.stringify(previewBody).includes(client.address.toLowerCase()), false);

  const strangerSession = await signIn(base, stranger);
  const hidden = await fetch(`${base}/api/agreements/${createdBody.agreement.id}`, { headers: headers(strangerSession.cookie) });
  assert.equal(hidden.status, 404);

  const clientSession = await signIn(base, client);
  const claimed = await fetch(`${base}/api/invitations/${invitation.token}/claim`, {
    method: "POST",
    headers: headers(clientSession.cookie),
    body: "{}",
  });
  assert.equal(claimed.status, 200);
  const again = await fetch(`${base}/api/invitations/${invitation.token}/claim`, {
    method: "POST",
    headers: headers(strangerSession.cookie),
    body: "{}",
  });
  assert.equal(again.status, 409);

  const seen = await fetch(`${base}/api/agreements/${createdBody.agreement.id}`, { headers: headers(clientSession.cookie) });
  const seenBody = await seen.json();
  assert.equal(seen.status, 200);
  assert.equal(seenBody.agreement.invitation.confirmed, false);
  const stillHidden = await fetch(`${base}/api/agreements/${createdBody.agreement.id}`, { headers: headers(strangerSession.cookie) });
  assert.equal(stillHidden.status, 404);

  const early = await fetch(`${base}/api/agreements/${createdBody.agreement.id}/commit`, {
    method: "POST",
    headers: headers(freelancerSession.cookie),
    body: "{}",
  });
  assert.equal(early.status, 409);

  const confirmed = await fetch(`${base}/api/agreements/${createdBody.agreement.id}/confirm-client`, {
    method: "POST",
    headers: headers(freelancerSession.cookie),
    body: "{}",
  });
  const confirmedBody = await confirmed.json();
  assert.equal(confirmed.status, 200, confirmedBody.error);
  assert.equal(confirmedBody.agreement.client.wallet.toLowerCase(), client.address.toLowerCase());

  const commit = await fetch(`${base}/api/agreements/${createdBody.agreement.id}/commit`, {
    method: "POST",
    headers: headers(freelancerSession.cookie),
    body: "{}",
  });
  const commitBody = await commit.json();
  assert.equal(commit.status, 503);
  assert.match(commitBody.error, /not configured/);
  await app.close();
});

test("privy sign-in ignores a caller-supplied user id", async () => {
  const { app, base } = await boot();
  const response = await fetch(`${base}/api/auth/privy`, {
    method: "POST",
    headers: { ...headers(), authorization: "Bearer not-a-privy-token" },
    body: JSON.stringify({ userId: "did:privy:fake", wallet: account().address, role: "client" }),
  });
  const body = await response.json();
  if (process.env.PRIVY_APP_SECRET) {
    assert.equal(response.status, 401);
  } else {
    assert.equal(response.status, 503);
  }
  assert.equal(body.user, undefined);
  assert.match(body.error, /not configured|could not be verified|Sign in/i);
  await app.close();
});

test("sample receipt is a simulated PDF", async () => {
  const { app, base } = await boot();
  const response = await fetch(`${base}/api/receipts/sample.pdf`, { headers: headers() });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  const decoded = pdfPlainText(bytes);
  assert.match(decoded, /SIMULATED RECEIPT/);
  assert.equal(decoded.includes("0x" + "ab".repeat(32)), false);
  await app.close();
});
