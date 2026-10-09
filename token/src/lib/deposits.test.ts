import { afterEach, describe, expect, it, vi } from "vitest";
import { byPrice, depositKey, parseDepositRow, totals, type Deposit } from "./deposits.ts";
import { isDeclarableURL, listDeposits, nextOpenDeposits } from "./node.ts";

const seller = "bafyreibh7ivi6gdwatcnx63uwcgkr5rcygej3lyvgkgma354lnifc6rguy";
const other = "bafyreiey2mpyfi3k64xe7ixxjyk2uv4hvaqovezmzivccexhekxxp35fee";
const make = (amountDeposited: bigint, amountDemanded: bigint, depositNonce = 1n, demander = seller): Deposit => ({ demander, amountDemanded, amountDeposited, depositNonce });
const wire = (deposit: Deposit) => ({ key: depositKey(deposit), demander: deposit.demander, amountDemanded: deposit.amountDemanded.toString(), nonce: deposit.depositNonce.toString(), amountDeposited: deposit.amountDeposited.toString() });

describe("deposit rows", () => {
  it("reads a node row, as strings or safe numbers", () => {
    expect(parseDepositRow(wire(make(500n, 100n, 7n)))).toEqual(make(500n, 100n, 7n));
    expect(parseDepositRow({ demander: seller, amountDemanded: 100, amountDeposited: 500, nonce: 7 })).toEqual(make(500n, 100n, 7n));
  });

  it("drops rows that are not usable sell orders", () => {
    const good = wire(make(500n, 100n));
    for (const bad of [
      null, [], "x",
      { ...good, demander: "<img src=x onerror=alert(1)>" },
      { ...good, amountDeposited: "0" }, // a spent marker
      { ...good, amountDemanded: "0" },
      { ...good, amountDemanded: "-1" }, { ...good, amountDemanded: "1e3" }, { ...good, amountDemanded: "0x10" },
      { ...good, amountDeposited: "18446744073709551616" },
      { ...good, nonce: 1.5 },
      { ...good, key: `${seller}/999/1` }, // key disagrees with its fields
    ]) expect(parseDepositRow(bad)).toBeNull();
  });

  it("orders cheapest first without rounding, then larger, then by key", () => {
    const cheap = make(300n, 100n), dear = make(100n, 100n), bait = make(1n, 900n);
    const sameBig = make(600n, 200n, 2n), sameOther = make(300n, 100n, 1n, other);
    const sorted = [bait, dear, sameOther, cheap, sameBig].sort(byPrice);
    expect(sorted[0]).toBe(sameBig); // same price as `cheap`, larger
    expect(sorted.slice(1, 3).map((d) => d.demander).sort()).toEqual([seller, other].sort());
    expect(sorted.at(-1)).toBe(bait);
    // 1/3 vs 33333333/100000000 must not compare equal.
    expect(byPrice(make(3n, 1n), make(100000000n, 33333333n))).toBe(1);
  });

  it("totals a selection exactly", () => {
    expect(totals([make(500n, 100n), make(7n, 3n, 2n)])).toEqual({ pay: 103n, receive: 507n });
    expect(totals([])).toEqual({ pay: 0n, receive: 0n });
  });
});

describe("node reads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts only public https node declarations", () => {
    for (const ok of ["https://lattice-mainnet-testnet.fly.dev", "https://node.example/rpc"]) expect(isDeclarableURL(ok)).toBe(true);
    for (const bad of [null, 7, "http://node.example", "https://localhost", "https://10.0.0.1", "https://[::1]", "https://printer.local",
      "https://intranet", "https://u:p@node.example", "https://node.example/x#", "https://node.example/?", "javascript:alert(1)", "http://127.0.0.1:8080"]) {
      expect(isDeclarableURL(bad)).toBe(false);
    }
    expect(isDeclarableURL("http://127.0.0.1:8080", true)).toBe(true);
    expect(isDeclarableURL("http://192.168.1.1:8080", true)).toBe(false);
  });

  it("follows the node's cursor, drops unusable rows and returns cheapest first", async () => {
    const first = [make(100n, 100n, 1n), make(300n, 100n, 2n)], second = [make(1n, 900n, 3n)];
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: URL) => {
      seen.push(`${input.pathname}?after=${input.searchParams.get("after")}&chainPath=${input.searchParams.get("chainPath")}`);
      const body = input.searchParams.get("after") === null
        ? { deposits: [...first.map(wire), { demander: "nope" }, { ...wire(make(5n, 5n, 9n)), amountDeposited: "0" }], next: "cursor-1" }
        : { deposits: second.map(wire) }; // the last page omits `next`
      return new Response(JSON.stringify(body));
    });
    const listing = await listDeposits("https://child.example", ["Nexus", "Payments"]);
    expect(listing.truncated).toBe(false);
    expect(listing.deposits.map((d) => d.depositNonce)).toEqual([2n, 1n, 3n]);
    expect(seen).toEqual(["/api/deposits?after=null&chainPath=Nexus/Payments", "/api/deposits?after=cursor-1&chainPath=Nexus/Payments"]);
  });

  it("pages through open orders in price order, skipping ones already paid for", async () => {
    const sorted = Array.from({ length: 30 }, (_, i) => make(100n, BigInt(100 + i), BigInt(i)));
    const bought = new Set([0n, 1n, 5n, 29n]);
    const asked: bigint[] = [];
    const check = async (deposit: Deposit) => { asked.push(deposit.depositNonce); return bought.has(deposit.depositNonce); };
    const first = await nextOpenDeposits("", [], sorted, 0, 10, check);
    expect(first.open.map((d) => d.depositNonce)).toEqual([2n, 3n, 4n, 6n, 7n, 8n, 9n, 10n, 11n, 12n]);
    expect(first.next).toBe(13);
    const rest = await nextOpenDeposits("", [], sorted, first.next, 100, check);
    expect(rest.open).toHaveLength(16); // 13..28; 29 is bought
    expect(rest.next).toBe(30);
    expect(new Set(asked).size).toBe(asked.length); // nothing is asked twice
    expect((await nextOpenDeposits("", [], sorted, 30, 10, check)).open).toEqual([]);
  });
});
