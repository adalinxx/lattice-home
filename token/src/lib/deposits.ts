// Sell deposits as a node lists them, and the arithmetic of choosing among
// them. Nothing here is verified: the wallet proves every deposit it pays for.

export interface Deposit {
  demander: string;
  amountDemanded: bigint; // parent units asked for the whole deposit
  amountDeposited: bigint; // child units locked
  depositNonce: bigint;
  /** The block that created the deposit, when the node reports it. */
  blockHeight?: bigint;
  blockHash?: string;
}

const ADDRESS = /^bafy[a-z2-7]{20,100}$/;
const CID = /^b[a-z2-7]{20,100}$/;
const UINT64_MAX = (1n << 64n) - 1n;

export function unsigned(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value)) {
    const parsed = BigInt(value);
    return parsed <= UINT64_MAX ? parsed : null;
  }
  return null;
}

export const depositKey = (deposit: Pick<Deposit, "demander" | "amountDemanded" | "depositNonce">): string => `${deposit.demander}/${deposit.amountDemanded}/${deposit.depositNonce}`;

/** One row of GET /api/deposits, or null when it is not a usable sell order
 * (malformed, a spent marker, or its key does not match its own fields). */
export function parseDepositRow(row: unknown): Deposit | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const { demander, amountDemanded, amountDeposited, nonce, key } = row as Record<string, unknown>;
  if (typeof demander !== "string" || !ADDRESS.test(demander)) return null;
  const demanded = unsigned(amountDemanded), deposited = unsigned(amountDeposited), depositNonce = unsigned(nonce);
  if (demanded === null || deposited === null || depositNonce === null || demanded === 0n || deposited === 0n) return null;
  const deposit: Deposit = { demander, amountDemanded: demanded, amountDeposited: deposited, depositNonce };
  if (key !== undefined && key !== depositKey(deposit)) return null;
  // Optional, and only as a pair: older nodes, and nodes that no longer hold
  // the states needed to locate the block, leave them out.
  const { blockHeight, blockHash } = row as Record<string, unknown>;
  const height = unsigned(blockHeight);
  if (height !== null && typeof blockHash === "string" && CID.test(blockHash)) {
    deposit.blockHeight = height;
    deposit.blockHash = blockHash;
  }
  return deposit;
}

/** Blocks on the node's chain from the deposit's block to its tip, inclusive.
 * Null when the node did not say where the deposit is, or its answers do not
 * fit together (a tip below the deposit's block). The node's word throughout. */
export function confirmations(deposit: Deposit, tipHeight: bigint | null): bigint | null {
  if (deposit.blockHeight === undefined || tipHeight === null || tipHeight < deposit.blockHeight) return null;
  return tipHeight - deposit.blockHeight + 1n;
}

/** Cheapest first: least parent asked per child unit. Exact; ties go to the
 * larger deposit, then to the key so the order is stable between reads. */
export function byPrice(a: Deposit, b: Deposit): number {
  const left = a.amountDemanded * b.amountDeposited, right = b.amountDemanded * a.amountDeposited;
  if (left !== right) return left < right ? -1 : 1;
  if (a.amountDeposited !== b.amountDeposited) return a.amountDeposited > b.amountDeposited ? -1 : 1;
  return depositKey(a) < depositKey(b) ? -1 : depositKey(a) > depositKey(b) ? 1 : 0;
}

export function totals(deposits: readonly Deposit[]): { pay: bigint; receive: bigint } {
  return deposits.reduce((sum, deposit) => ({ pay: sum.pay + deposit.amountDemanded, receive: sum.receive + deposit.amountDeposited }), { pay: 0n, receive: 0n });
}
