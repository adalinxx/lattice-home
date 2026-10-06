import type { OrderIntent } from "./intent.ts";

const STAGED_INTENT_KEY = "lattice-exchange:staged-intent";

export function stageIntent(intent: OrderIntent): void {
  sessionStorage.setItem(STAGED_INTENT_KEY, JSON.stringify(intent));
}

export function stagedIntent(): OrderIntent | null {
  try {
    const value = sessionStorage.getItem(STAGED_INTENT_KEY);
    return value ? JSON.parse(value) as OrderIntent : null;
  } catch {
    return null;
  }
}
