// Read-only node access for the Buy list: find the child chain's node, list
// its sell deposits, and ask the parent which are already paid for. Answers
// are shown, never trusted: the wallet proves each deposit before it pays.

import { NEXUS_NODE } from "./config.ts";
import { byPrice, depositKey, parseDepositRow, unsigned, type Deposit } from "./deposits.ts";

const TIMEOUT_MS = 8_000;
const LIST_PAGE = 100;
const MAX_LIST_PAGES = 20;
const MAX_ENDPOINT_CANDIDATES = 5;

export class NodeReadError extends Error {}

async function getJSON(base: string, path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = new URL(base.replace(/\/$/, "") + path);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", credentials: "omit", headers: { Accept: "application/json" } });
  } catch {
    throw new NodeReadError(`${url.host} did not answer.`);
  }
  if (!response.ok) throw new NodeReadError(`${url.host} answered HTTP ${response.status}.`);
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new NodeReadError(`${url.host} sent an unexpected answer.`);
  return body as Record<string, unknown>;
}

/** A node URL declared by another node: public https only. Loopback http is
 * allowed when the page itself is being developed on loopback. */
export function isDeclarableURL(value: unknown, developing = false): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.username || url.password || value.includes("?") || value.includes("#")) return false;
    if (developing && url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost")) return true;
    if (url.protocol !== "https:" || !host.includes(".")) return false;
    if (/^[0-9.]+$/.test(host) || host.startsWith("[")) return false;
    return !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
  } catch {
    return false;
  }
}

const developing = (): boolean => typeof location !== "undefined" && ["127.0.0.1", "localhost"].includes(location.hostname);
const endpoints = new Map<string, Promise<string>>();

/** A node that answers for `chain`, walked down from the Nexus read service
 * through each parent's declared endpoints. */
export function endpointFor(chain: readonly string[]): Promise<string> {
  const name = chain.join("/");
  let found = endpoints.get(name);
  if (!found) {
    found = resolveEndpoint(chain);
    endpoints.set(name, found);
    found.catch(() => endpoints.delete(name));
  }
  return found;
}

async function resolveEndpoint(chain: readonly string[]): Promise<string> {
  if (chain.length === 1) return NEXUS_NODE;
  const name = chain.join("/");
  const parent = await endpointFor(chain.slice(0, -1));
  const listing = await getJSON(parent, "/api/chain/endpoints", { chainPath: name });
  const declared = Array.isArray(listing.endpoints) ? listing.endpoints : [];
  const candidates = declared.filter((url) => isDeclarableURL(url, developing())).slice(0, MAX_ENDPOINT_CANDIDATES) as string[];
  for (const candidate of candidates) {
    try {
      const info = await getJSON(candidate, "/api/chain/info", { chainPath: name });
      if (Array.isArray(info.chain) && info.chain.join("/") === name) return candidate.replace(/\/$/, "");
    } catch { /* try the next declared node */ }
  }
  throw new NodeReadError(`No reachable node serves ${name}.`);
}

/** Every sell deposit the child node lists, cheapest first. `truncated` when
 * the node had more pages than this page reads. `tipHeight` is the node's tip
 * read just before the list, so a confirmation count is never overstated by
 * blocks that arrived while the list was being read. */
export async function listDeposits(childNode: string, childChain: readonly string[]): Promise<{ deposits: Deposit[]; truncated: boolean; tipHeight: bigint | null }> {
  const chainPath = childChain.join("/");
  const tipHeight = await getJSON(childNode, "/api/chain/info", { chainPath }).then((info) => unsigned(info.height), () => null);
  const found = new Map<string, Deposit>();
  let after: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const body = await getJSON(childNode, "/api/deposits", { chainPath, limit: String(LIST_PAGE), ...(after === undefined ? {} : { after }) });
    if (!Array.isArray(body.deposits)) throw new NodeReadError("The node did not return a deposit list.");
    for (const row of body.deposits) {
      const deposit = parseDepositRow(row);
      if (deposit) found.set(depositKey(deposit), deposit);
    }
    // A node with nothing further sends null or omits the cursor.
    if (typeof body.next !== "string" || body.next === after) return { deposits: [...found.values()].sort(byPrice), truncated: false, tipHeight };
    after = body.next;
  }
  return { deposits: [...found.values()].sort(byPrice), truncated: true, tipHeight };
}

/** Whether the parent chain already holds a payment for this deposit. */
export async function isBought(parentNode: string, childChain: readonly string[], deposit: Deposit): Promise<boolean> {
  const body = await getJSON(parentNode, "/api/receipt-state", {
    demander: deposit.demander, amount: deposit.amountDemanded.toString(), nonce: deposit.depositNonce.toString(), chainPath: childChain.join("/"),
  });
  if (typeof body.exists !== "boolean") throw new NodeReadError("The parent node sent an unexpected receipt answer.");
  return body.exists;
}

/** The next `count` deposits from `start` that nobody has paid for yet, and
 * where to continue from. Checks a few at a time, in price order. */
export async function nextOpenDeposits(
  parentNode: string, childChain: readonly string[], sorted: readonly Deposit[], start: number, count: number,
  bought: (deposit: Deposit) => Promise<boolean> = (deposit) => isBought(parentNode, childChain, deposit),
): Promise<{ open: Deposit[]; next: number }> {
  const open: Deposit[] = [];
  let index = start;
  while (open.length < count && index < sorted.length) {
    const batch = sorted.slice(index, index + Math.min(6, count - open.length));
    const taken = await Promise.all(batch.map(bought));
    batch.forEach((deposit, position) => { if (!taken[position]) open.push(deposit); });
    index += batch.length;
  }
  return { open, next: index };
}
