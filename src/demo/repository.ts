import type { DemoState } from "../domain/types";
import { buildSeed } from "./seed";

/**
 * Demo persistence boundary. The UI talks to the store, and the store talks
 * to this repository. Browser storage is only a demo cache. Real payments
 * must be read from the contract after confirmation, not from localStorage.
 */
export interface DemoRepository {
  load(): DemoState;
  save(state: DemoState): void;
  reset(): DemoState;
}

const KEY = "proofpay.demo.v1";

function valid(value: unknown): value is DemoState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<DemoState>;
  return state.version === 1 && Array.isArray(state.agreements) && Array.isArray(state.ledger);
}

export const browserDemoRepository: DemoRepository = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return buildSeed();
      const parsed: unknown = JSON.parse(raw);
      if (!valid(parsed)) return buildSeed();
      return parsed;
    } catch {
      return buildSeed();
    }
  },
  save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  },
  reset() {
    const seed = buildSeed();
    localStorage.setItem(KEY, JSON.stringify(seed));
    return seed;
  },
};

export function memoryRepository(initial = buildSeed()): DemoRepository {
  let current = structuredClone(initial);
  return {
    load: () => structuredClone(current),
    save: (state) => {
      current = structuredClone(state);
    },
    reset: () => {
      current = buildSeed();
      return structuredClone(current);
    },
  };
}
