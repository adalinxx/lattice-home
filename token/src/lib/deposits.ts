// Sell deposits as a node lists them, and the arithmetic of choosing among
// them. Nothing here is verified: the wallet proves every deposit it pays for.

export interface Deposit {
  demander: string;
  amountDemanded: bigint; // parent units asked for the whole deposit
  amountDeposited: bigint; // child units locked
  depositNonce: bigint;
}

const ADDRESS = /^bafy[a-z2-7]{20,100}$/;
const UINT64_MAX = (1n << 64n) - 1n;

function unsigned(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value)) {
    const parsed = BigInt(value);
    return parsed <= UINT64_MAX ? parsed : null;
  }
  return null;
}

export const depositKey = (deposit: Deposit): string => `${deposit.demander}/${deposit.amountDemanded}/${deposit.depositNonce}`;

/** One row of GET /api/deposits, or null when it is not a usable sell order
 * (malformed, a spent marker, or its key does not match its own fields). */
export function parseDepositRow(row: unknown): Deposit | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const { demander, amountDemanded, amountDeposited, nonce, key } = row as Record<string, unknown>;
  if (typeof demander !== "string" || !ADDRESS.test(demander)) return null;
  const demanded = unsigned(amountDemanded), deposited = unsigned(amountDeposited), depositNonce = unsigned(nonce);
  if (demanded === null || deposited === null || depositNonce === null || demanded === 0n || deposited === 0n) return null;
  const deposit = { demander, amountDemanded: demanded, amountDeposited: deposited, depositNonce };
  return key === undefined || key === depositKey(deposit) ? deposit : null;
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
