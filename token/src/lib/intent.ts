export const INTENT_VERSION = 1 as const;
/** Fixed-point scale of the sell form's exchange-rate helper. Amounts have no
 * scale: they are whole units, as the chain, the explorer and the wallet show them. */
export const RATE_SCALE = 100_000_000n;
export const UINT64_MAX = (1n << 64n) - 1n;

export type OrderSide = "sell_child" | "buy_child";
export type OrderType = "limit" | "take";

interface OrderIntentBase {
  readonly version: typeof INTENT_VERSION;
  readonly intentId: string;
  readonly parentChain: readonly string[];
  readonly childChain: readonly string[];
  readonly asset: "LAT";
  readonly expiresAt: string;
}

export interface SellLimitIntent extends OrderIntentBase {
  readonly side: "sell_child";
  readonly orderType: "limit";
  readonly amountDeposited: string;
  readonly amountDemanded: string;
}

/** One sell deposit the buyer chose, identified exactly as consensus keys it. */
export interface SelectedDeposit {
  readonly demander: string;
  readonly amountDemanded: string;
  readonly amountDeposited: string;
  readonly depositNonce: string;
}

/** Buy exactly these deposits. The wallet must prove each one itself; the
 * list here is a request, not evidence. */
export interface BuyTakeIntent extends OrderIntentBase {
  readonly side: "buy_child";
  readonly orderType: "take";
  readonly deposits: readonly SelectedDeposit[];
}

export type OrderIntent = SellLimitIntent | BuyTakeIntent;

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

/** A typed amount: a whole number of units, above zero and within the UInt64
 * consensus stores. Refused here so the page never stages what a wallet must reject. */
export function parseAmount(value: string): bigint {
  const text = value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error("Enter a whole number of units.");
  const units = BigInt(text);
  if (units <= 0n) throw new Error("The amount must be greater than zero.");
  if (units > UINT64_MAX) throw new Error("The amount is larger than a chain can hold.");
  return units;
}

/** A typed exchange rate, to at most 8 decimal places, as RATE_SCALE fixed point. */
export function parseRate(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,8}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a rate with no more than 8 decimal places.");
  const rate = BigInt(match[1]!) * RATE_SCALE + BigInt((match[2] ?? "").padEnd(8, "0") || "0");
  if (rate <= 0n) throw new Error("The rate must be greater than zero.");
  return rate;
}

/** The displayed rate for a sell: parent units per child unit, as RATE_SCALE
 * fixed point, rounded to the nearest. `exact` is false when it was rounded.
 * A helper for the form only; an order carries its two amounts, never a rate. */
export function exchangeRate(amountDeposited: bigint, amountDemanded: bigint): { units: bigint; exact: boolean } {
  if (amountDeposited <= 0n || amountDemanded <= 0n) throw new Error("Both amounts must be greater than zero.");
  const scaled = amountDemanded * RATE_SCALE;
  return { units: (scaled + amountDeposited / 2n) / amountDeposited, exact: scaled % amountDeposited === 0n };
}

/** The parent amount a typed rate implies for a deposit, rounded up to a whole
 * unit so the seller never asks for less than the rate they entered. */
export function demandedForRate(amountDeposited: bigint, rateUnits: bigint): bigint {
  if (amountDeposited <= 0n || rateUnits <= 0n) throw new Error("The amount and rate must be greater than zero.");
  return (amountDeposited * rateUnits + RATE_SCALE - 1n) / RATE_SCALE;
}

/** The child amount to sell for a wanted parent amount at a typed rate, rounded
 * down so the seller never gives more than the rate implies. Null when the
 * wanted amount is too small to sell even one unit at that rate. */
export function depositedForRate(amountDemanded: bigint, rateUnits: bigint): bigint | null {
  if (amountDemanded <= 0n || rateUnits <= 0n) throw new Error("The amount and rate must be greater than zero.");
  const amountDeposited = amountDemanded * RATE_SCALE / rateUnits;
  return amountDeposited > 0n ? amountDeposited : null;
}

const ADDRESS = /^bafy[a-z2-7]{20,100}$/;
function marketPair(parent: string, child: string): { parentChain: string[]; childChain: string[] } {
  const parentChain = parseChainPath(parent);
  const childChain = parseChainPath(child);
  if (!isAdjacent(parentChain, childChain) || childChain.length !== parentChain.length + 1) {
    throw new Error("The market must pair a child chain with its direct parent.");
  }
  return { parentChain, childChain };
}

function intentBase(pair: { parentChain: string[]; childChain: string[] }, now = new Date()): OrderIntentBase {
  return {
    version: INTENT_VERSION,
    intentId: crypto.randomUUID(),
    parentChain: pair.parentChain,
    childChain: pair.childChain,
    asset: "LAT",
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
  };
}

/** A sell: lock `amount` of the child token and demand exactly `amountDemanded`
 * of the parent token for all of it. Both are the amounts the user typed;
 * deriving one from a price would round, and the terms are consensus data. */
export function createSellIntent(input: {
  parentChain: string;
  childChain: string;
  amount: string;
  amountDemanded: string;
  now?: Date;
}): SellLimitIntent {
  const pair = marketPair(input.parentChain, input.childChain);
  const amountDeposited = parseAmount(input.amount);
  const amountDemanded = parseAmount(input.amountDemanded);
  return { ...intentBase(pair, input.now), side: "sell_child", orderType: "limit", amountDeposited: amountDeposited.toString(), amountDemanded: amountDemanded.toString() };
}

/** A buy of the exact deposits the user ticked, in atomic units. */
export function createTakeIntent(input: {
  parentChain: string;
  childChain: string;
  deposits: readonly { demander: string; amountDemanded: bigint; amountDeposited: bigint; depositNonce: bigint }[];
  now?: Date;
}): BuyTakeIntent {
  const pair = marketPair(input.parentChain, input.childChain);
  if (input.deposits.length === 0) throw new Error("Select at least one sell order.");
  const seen = new Set<string>();
  const deposits = input.deposits.map((deposit) => {
    if (!ADDRESS.test(deposit.demander)) throw new Error("A selected sell order has an invalid seller address.");
    if (deposit.amountDemanded <= 0n || deposit.amountDeposited <= 0n) throw new Error("A selected sell order has a zero amount.");
    if (deposit.depositNonce < 0n || [deposit.amountDemanded, deposit.amountDeposited, deposit.depositNonce].some((value) => value > UINT64_MAX)) {
      throw new Error("A selected sell order is out of range.");
    }
    const key = `${deposit.demander}/${deposit.amountDemanded}/${deposit.depositNonce}`;
    if (seen.has(key)) throw new Error("A sell order was selected twice.");
    seen.add(key);
    return {
      demander: deposit.demander, amountDemanded: deposit.amountDemanded.toString(),
      amountDeposited: deposit.amountDeposited.toString(), depositNonce: deposit.depositNonce.toString(),
    };
  });
  return { ...intentBase(pair, input.now), side: "buy_child", orderType: "take", deposits };
}
