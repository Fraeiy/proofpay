# ProofPay

Testnet milestone payments for freelance social and community work. One wallet can be the freelancer on some agreements and the client on others. The view switch only changes which list you see.

This is a Monad testnet release. tUSDC is an app-owned test token with no monetary value. A missed deadline does not move funds. If the two people disagree or one disappears, a funded milestone can stay locked. There is no timeout refund and no admin withdrawal.

## Local setup

Requirements: Node.js 22, npm, and a browser wallet that can add Monad testnet (or a phone wallet’s in-app browser).

```bash
cd hackathons/proofpay
npm install
copy .env.example .env
npm run server
```

In a second terminal:

```bash
npm run dev
```

Open http://127.0.0.1:5174

The Vite app proxies `/api` to http://127.0.0.1:8792. Sample data stays in this browser only. Choose “Look at sample data” on the welcome screen. That mode is labelled Sample and can impersonate the other person. The live app does not.

The server creates the SQLite schema when it starts. There is no separate migration CLI. The file defaults to `./data/proofpay.sqlite`. Delete that file to start over. `data/` is gitignored.

## Environment

Copy `.env.example`. Values below are placeholders. Do not commit `.env`. Do not put a seed phrase or a mainnet key in it.

| Name | Purpose |
| --- | --- |
| `PORT` | API port. Default `8792`. |
| `PROOFPAY_DB` | SQLite file. Default `./data/proofpay.sqlite`. |
| `PROOFPAY_ORIGINS` | Browser origins allowed to call the API. Default `http://127.0.0.1:5174,http://localhost:5174`. |
| `COOKIE_SECURE` | Set `1` only behind HTTPS. Local HTTP stays `0`. |
| `CHAIN_ID` | `10143` for Monad testnet. |
| `MONAD_RPC_URL` | Default `https://testnet-rpc.monad.xyz`. |
| `EXPLORER_URL` | Default `https://testnet.monadvision.com`. |
| `ESCROW_ADDRESS` | Deployed `ProofPayEscrow`. Empty until you deploy. |
| `TOKEN_ADDRESS` | Deployed `ProofPayTestToken`. Empty until you deploy. |
| `DEPLOYER_PRIVATE_KEY` | Testnet-only key, local file only. Leave empty to skip deployment. |

The API reads `.env` itself. Hardhat does too, from the project directory.

## Contracts

Lifecycle rules are in `contracts/LIFECYCLE.md`.

```bash
npm run test:contracts
npm run deploy:testnet
```

`npm run test:contracts` runs on Hardhat’s local chain (31337). That is not Monad testnet.

`npm run deploy:testnet` deploys `ProofPayTestToken` and `ProofPayEscrow` to chain 10143 and writes `data/deployment.json`. The API uses that file when the address env vars are empty. Restart the API after deploying.

No contract is deployed from this repository yet. There is no explorer link until a testnet deploy writes a receipt.

## Network

Checked against the Monad docs on 2026-09-28 (`docs.monad.xyz/developer-essentials/testnet`):

| | |
| --- | --- |
| Network | Monad testnet |
| Chain ID | 10143 (`0x279f`) |
| Currency | MON |
| RPC | https://testnet-rpc.monad.xyz |
| Faucet | https://faucet.monad.xyz |
| Explorer | https://testnet.monadvision.com |

Public testnet RPC is rate-limited. The default `https://testnet-rpc.monad.xyz` is the QuickNode endpoint (about 50 requests per second). The Foundation endpoint `https://rpc-testnet.monadinfra.com` is about 20 requests per second and does not allow batch requests. The app reconciles transactions it already knows about. It does not scan the whole chain.

MON for gas comes from the faucet. tUSDC comes from the token’s `faucet()` after the token address is configured. Use “Get test tUSDC” in Account. That button does nothing useful until `TOKEN_ADDRESS` is set. tUSDC is not a stablecoin and has no monetary value.

## How to try it with two people

1. Deploy the contracts with a testnet-only key, or run against a local Hardhat node and point `CHAIN_ID`, `MONAD_RPC_URL`, `ESCROW_ADDRESS`, and `TOKEN_ADDRESS` at it.
2. Restart the API so it loads those addresses.
3. Person A opens http://127.0.0.1:5174, connects a wallet, and signs the sign-in message. That message does not move funds or approve spending.
4. Person A creates an agreement, puts person B’s wallet in the client field, and commits the terms. The wallet then sends `createAgreement`.
5. Person B opens the same app, signs in with the client wallet, opens the agreement, and accepts that exact version.
6. Person B allows the exact tUSDC amount, then deposits that milestone.
7. Person A submits a note and links. Person B can request changes or release the full amount.
8. Either person can propose cancellation of an unpaid funded milestone. Funds move back to the client only after the other person approves that same proposal.
9. A confirmed payment has “Download receipt”. The PDF is generated from the stored confirmed record.

A shared URL is not access. A different wallet sees a private-agreement message and not the brief.

## Authentication and permissions

Wallet connection is not a session. The server issues a random single-use challenge that expires in 10 minutes. The wallet signs a readable message. The server checks the signature, nonce, domain, URI, chain id, and timestamps, then consumes the challenge and sets an HttpOnly `proofpay_session` cookie (SameSite=Lax, 7 days). Secure is on when `COOKIE_SECURE=1`.

Writes require an allowlisted `Origin` and the header `x-proofpay-request: 1`. Sign-in attempts are rate-limited per IP. Logout deletes the session. An expired session asks you to sign in again. Changing or disconnecting the wallet logs the previous session out.

The signed-in wallet is the identity. “My freelance work” and “My hires” filter lists. They do not change who can fund, submit, or release. The API and the contract both check the party on that agreement. A client-supplied role flag is ignored. A person cannot be both parties on one agreement.

Login, acceptance, token allowance, funding, and payment are separate wallet actions.

## Payments and cancellation

Onchain state decides funding, balances, payment, and refunds. The database is a cache. A button, an API response, or a transaction hash does not mark a milestone paid.

Milestone path: Unfunded → Funded → Submitted → Paid. A revision goes Submitted → Changes requested → Submitted. Only the client funds and releases. Only the freelancer submits. The amount and token are fixed. A milestone cannot be funded or paid twice.

Cancellation of an unpaid funded milestone refunds the full amount to the client, and only after both people agree to the current proposal. Replacing or withdrawing a proposal invalidates the old approval. Paying or requesting changes also drops an open proposal. A proposal by itself does not move funds.

Due dates are information. They do not pay or refund anyone.

## Receipts

Confirmed payments, deposits, and refunds can download a PDF. Deposits are labelled deposit confirmations. The file says `TESTNET PAYMENT — NO REAL MONETARY VALUE.` It is not a tax invoice. Receipt data comes from the confirmed record, and only a participant can download it.

`node scripts/sample-receipt.mjs` writes `docs/sample-receipt.pdf`. That file is a fictional layout. It is not a Monad transaction and it has no explorer link.

## Checks

```bash
npm test
npm run test:api
npm run test:contracts
npm run test:flow
npm run typecheck
```

`npm test` covers the in-browser sample rules. `npm run test:api` covers sign-in replay, expiry, wrong site, private agreements, role spoofing, logout, rate limits, an unverified hash, and a private PDF. `npm run test:contracts` covers acceptance, funding, revision, payment, cancellation, a stale approval, and a token that returns false. `npm run test:flow` runs that same path through the API and a local Hardhat chain with two wallets. It is not a Monad testnet transaction.

## What is not deployed

No Monad testnet contracts are deployed from this checkout, because no deployer key is configured. Do not paste a key into chat. Put a testnet-only key in local `.env` as `DEPLOYER_PRIVATE_KEY` and run `npm run deploy:testnet`.

Free hosting checked again on 2026-09-28 still does not fit this app without losing data or starting a paid plan. Render’s free web service has an ephemeral disk, so SQLite disappears on restart, and its free Postgres expires after 30 days. Fly.io’s current offer is a short trial, not a standing free disk, and it asks for a card. Koyeb no longer offers a standing free web service with a disk. Vercel’s serverless disk is ephemeral too. Turso has a free SQLite tier, but this checkout has no Turso account, and switching the database driver would be a new service. This app is meant to run locally until a host with a persistent disk is available at no charge.

Session cookies on a public HTTPS host need `COOKIE_SECURE=1`. A request whose browser origin matches the site host is accepted. `PROOFPAY_ORIGINS` is still required for the local Vite app, because that origin is port 5174 and the API is port 8792.

The Vercel project serves the same UI and API. Its SQLite file lives on the function’s temporary disk and does not survive a restart or a new instance. Use the local server when the agreement history has to stick around. No contract is configured on that deployment until `ESCROW_ADDRESS` and `TOKEN_ADDRESS` are set in the Vercel project.
