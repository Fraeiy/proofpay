import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  wallet TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'both',
  preferred_view TEXT NOT NULL DEFAULT 'freelancer',
  theme TEXT NOT NULL DEFAULT 'system',
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  domain TEXT NOT NULL,
  uri TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agreements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  freelancer_wallet TEXT NOT NULL,
  client_wallet TEXT NOT NULL,
  client_name TEXT NOT NULL,
  terms_hash TEXT,
  terms_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  replaced_by TEXT,
  chain_id INTEGER,
  chain_agreement_id TEXT,
  shared_at TEXT,
  freelancer_accepted_at TEXT,
  client_accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  deliverables_json TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  phase TEXT NOT NULL,
  submission_ref TEXT,
  cancel_proposer TEXT,
  cancel_nonce INTEGER NOT NULL DEFAULT 0,
  cancel_note TEXT,
  cancel_draft_note TEXT,
  base_phase TEXT,
  cancel_proposed_at TEXT,
  funded_at TEXT,
  paid_at TEXT,
  refunded_at TEXT,
  UNIQUE(agreement_id, position)
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL,
  note TEXT NOT NULL,
  links_json TEXT NOT NULL,
  ref_hash TEXT,
  status TEXT NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL,
  submission_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  result TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  from_wallet TEXT NOT NULL,
  to_wallet TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  tx_hash TEXT,
  log_index INTEGER,
  chain_id INTEGER,
  block_time TEXT,
  detail TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_event
  ON ledger(chain_id, tx_hash, log_index)
  WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tx_attempts (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  agreement_id TEXT,
  milestone_id TEXT,
  purpose TEXT NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function openDatabase(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}
