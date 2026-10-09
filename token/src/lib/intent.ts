export const INTENT_VERSION = 1 as const;
export const ATOMIC_UNITS_PER_LAT = 100_000_000n;

export type OrderSide = "sell_child" | "buy_child";
export type OrderType = "limit" | "market";

interface OrderIntentBase {
  readonly version: typeof INTENT_VERSION;
  readonly intentId: string;
  readonly parentChain: readonly string[];
  readonly childChain: readonly string[];
  readonly asset: "LAT";
  readonly recipient?: string;
  readonly expiresAt: string;
  readonly returnUrl?: string;
}

export interface SellLimitIntent extends OrderIntentBase {
  readonly side: "sell_child";
  readonly orderType: "limit";
  readonly amountDeposited: string;
  readonly amountDemanded: string;
}

export interface BuyMarketIntent extends OrderIntentBase {
  readonly side: "buy_child";
  readonly orderType: "market";
  readonly maxAmountDemanded?: string;
  readonly desiredAmountDeposited?: string;
}

export type OrderIntent = SellLimitIntent | BuyMarketIntent;

export function parseChainPath(value: string): string[] {
  const parts = value.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts[0] !== "Nexus") throw new Error("A chain path must begin with Nexus.");
  if (parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) {
    throw new Error("A chain path contains an unsupported character.");
  }
  return parts;
}

/** The child chain named by a page URL, or null unless it is a well-formed
 * path below Nexus. Page markup is built from this value. */
export function childChainFromQuery(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parts = parseChainPath(value);
    return parts.length >= 2 ? parts : null;
  } catch {
    return null;
  }
}

export function isAdjacent(source: readonly string[], destination: readonly string[]): boolean {
  if (Math.abs(source.length - destination.length) !== 1) return false;
  const shorter = source.length < destination.length ? source : destination;
  const longer = source.length < destination.length ? destination : source;
  return shorter.every((part, index) => part === longer[index]);
}

export function routeBetween(source: readonly string[], destination: readonly string[]): string[][] {
  let shared = 0;
  while (shared < source.length && shared < destination.length && source[shared] === destination[shared]) shared++;
  if (shared === 0) throw new Error("Both chains must belong to Nexus.");

  const route: string[][] = [];
  for (let length = source.length; length >= shared; length--) route.push(source.slice(0, length));
  for (let length = shared + 1; length <= destination.length; length++) route.push(destination.slice(0, length));
  return route;
}

export function parseAmount(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,8}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter an amount with no more than 8 decimal places.");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(8, "0") || "0");
  const units = whole * ATOMIC_UNITS_PER_LAT + fraction;
  if (units <= 0n) throw new Error("The amount must be greater than zero.");
  return units;
}

export function createOrderIntent(input: {
  parentChain: string;
  childChain: string;
  side: OrderSide;
  amount: string;
  amountBasis?: "parent" | "child";
  /** Sell only: the exact parent amount demanded for the whole deposit. */
  amountDemanded?: string;
  recipient?: string;
  now?: Date;
}): OrderIntent {
  const parentChain = parseChainPath(input.parentChain);
  const childChain = parseChainPath(input.childChain);
  if (!isAdjacent(parentChain, childChain) || childChain.length !== parentChain.length + 1) {
    throw new Error("The market must pair a child chain with its direct parent.");
  }
  const amount = parseAmount(input.amount);
  // Both sell terms are the amounts the user typed. Deriving one from a price
  // would round, and the deposit's terms are consensus data.
  const amountDemanded = input.side === "sell_child" ? parseAmount(input.amountDemanded ?? "") : undefined;
  const recipient = input.recipient?.trim();
  if (recipient && !/^bafy[a-z2-7]+$/.test(recipient)) throw new Error("Enter a valid Lattice address.");

  const now = input.now ?? new Date();
  const common: OrderIntentBase = {
    version: INTENT_VERSION,
    intentId: crypto.randomUUID(),
    parentChain,
    childChain,
    asset: "LAT",
    ...(recipient ? { recipient } : {}),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    ...(typeof location === "undefined" ? {} : { returnUrl: `${location.origin}${location.pathname}#/status` }),
  };
  if (input.side === "sell_child") {
    return { ...common, side: "sell_child", orderType: "limit", amountDeposited: amount.toString(), amountDemanded: amountDemanded!.toString() };
  }
  return input.amountBasis === "child"
    ? { ...common, side: "buy_child", orderType: "market", desiredAmountDeposited: amount.toString() }
    : { ...common, side: "buy_child", orderType: "market", maxAmountDemanded: amount.toString() };
}
