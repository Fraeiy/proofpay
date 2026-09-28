import type { MilestonePhase, Role } from "./types";

export const TOKEN = "tUSDC";
export const TOKEN_LABEL = "tUSDC, a simulated test token";
export const NETWORK_LABEL = "Monad testnet (simulated)";
export const DEMO_NOTE = "Simulated in this browser. Not a Monad transaction.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function createId(prefix: string): string {
  const bytes = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `${prefix}_${bytes}`;
}

export function fnv(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function simulatedReference(id: string): string {
  return `sim_${fnv(id)}`;
}

export function todayISO(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function nowIso(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${todayISO(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year ?? 2026, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return todayISO(date);
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const monthName = MONTHS[(month ?? 1) - 1] ?? "Jan";
  return `${day ?? 1} ${monthName} ${year ?? ""}`;
}

export function formatDateTime(iso: string): string {
  if (!iso.includes("T")) return formatDate(iso);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return formatDate(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${formatDate(todayISO(date))}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(cents));
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${fraction}`;
}

export function parseAmountToCents(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000_00) return null;
  return cents;
}

export function isWallet(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function shortWallet(value: string): string {
  const wallet = value.trim();
  if (wallet.length < 12) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export function isEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isOverdue(dueDate: string, phase: MilestonePhase, today: string): boolean {
  if (phase === "paid" || phase === "refunded") return false;
  return dueDate < today;
}

export function fundsAreHeld(phase: MilestonePhase): boolean {
  return (
    phase === "funded" ||
    phase === "submitted" ||
    phase === "changes_requested" ||
    phase === "cancellation_proposed"
  );
}

export function otherRole(role: Role): Role {
  return role === "freelancer" ? "client" : "freelancer";
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
