import { describe, expect, it } from "vitest";
import { childChainFromQuery, createSellIntent, createTakeIntent, demandedForRate, depositedForRate, exchangeRate, isAdjacent, parseAmount, parseChainPath, routeBetween } from "./intent.ts";
import { escapeHTML } from "./format.ts";

describe("chain routing", () => {
  it("recognizes a direct parent-child edge", () => {
    expect(isAdjacent(["Nexus"], ["Nexus", "Payments"])).toBe(true);
    expect(isAdjacent(["Nexus", "A"], ["Nexus", "B"])).toBe(false);
  });

  it("routes between branches through their common ancestor", () => {
    expect(routeBetween(["Nexus", "A", "B"], ["Nexus", "C"])).toEqual([
      ["Nexus", "A", "B"], ["Nexus", "A"], ["Nexus"], ["Nexus", "C"],
    ]);
  });
});

describe("intent inputs", () => {
  it("parses atomic units without floating point", () => {
    expect(parseAmount("1.00000001")).toBe(100_000_001n);
    expect(parseAmount("0.5")).toBe(50_000_000n);
  });

  it("requires rooted chain paths", () => {
    expect(parseChainPath("Nexus/Payments")).toEqual(["Nexus", "Payments"]);
    expect(() => parseChainPath("Payments")).toThrow(/begin with Nexus/);
  });

  it("maps a limit sell to exact deposit terms", () => {
    const intent = createSellIntent({
      parentChain: "Nexus", childChain: "Nexus/Payments", amount: "2", amountDemanded: "3",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(intent.side).toBe("sell_child");
    expect(intent.orderType).toBe("limit");
    expect(intent.amountDeposited).toBe("200000000");
    expect(intent.amountDemanded).toBe("300000000");
    expect(intent.expiresAt).toBe("2026-01-01T00:15:00.000Z");
  });

  it("keeps both sell amounts exactly as typed, whatever their ratio", () => {
    const sell = (amount: string, amountDemanded: string) => {
      const intent = createSellIntent({ parentChain: "Nexus", childChain: "Nexus/Payments", amount, amountDemanded });
      return [intent.amountDeposited, intent.amountDemanded];
    };
    // Ratios with no short decimal form: a derived price cannot express them.
    expect(sell("3", "0.3")).toEqual(["300000000", "30000000"]);
    expect(sell("3", "1")).toEqual(["300000000", "100000000"]);
    expect(sell("7", "2")).toEqual(["700000000", "200000000"]);
    expect(sell("0.1", "0.3")).toEqual(["10000000", "30000000"]);
    expect(sell("0.00000003", "0.00000001")).toEqual(["3", "1"]);
  });

  it("refuses a sell without a demanded amount or off a direct parent", () => {
    const base = { parentChain: "Nexus", childChain: "Nexus/Payments", amount: "2" };
    expect(() => createSellIntent({ ...base, amountDemanded: "" })).toThrow(/amount/);
    expect(() => createSellIntent({ ...base, amountDemanded: "0" })).toThrow(/greater than zero/);
    expect(() => createSellIntent({ ...base, childChain: "Nexus/A/B", amountDemanded: "1" })).toThrow(/direct parent/);
  });
});

describe("buying selected sell orders", () => {
  const seller = "bafyreibh7ivi6gdwatcnx63uwcgkr5rcygej3lyvgkgma354lnifc6rguy";
  const deposit = (depositNonce: bigint, amountDeposited = 500n, amountDemanded = 100n) => ({ demander: seller, amountDemanded, amountDeposited, depositNonce });
  const base = { parentChain: "Nexus", childChain: "Nexus/Payments" };

  it("names each selected deposit by its exact consensus terms", () => {
    const intent = createTakeIntent({ ...base, deposits: [deposit(1n), deposit(18446744073709551615n, 7n, 3n)], now: new Date("2026-01-01T00:00:00Z") });
    expect(intent.side).toBe("buy_child");
    expect(intent.orderType).toBe("take");
    expect(intent.deposits).toEqual([
      { demander: seller, amountDemanded: "100", amountDeposited: "500", depositNonce: "1" },
      { demander: seller, amountDemanded: "3", amountDeposited: "7", depositNonce: "18446744073709551615" },
    ]);
    expect(JSON.stringify(intent)).not.toMatch(/maxAmountDemanded|desiredAmountDeposited/);
  });

  it("refuses an empty, repeated, malformed or out-of-range selection", () => {
    expect(() => createTakeIntent({ ...base, deposits: [] })).toThrow(/at least one/);
    expect(() => createTakeIntent({ ...base, deposits: [deposit(1n), deposit(1n)] })).toThrow(/twice/);
    expect(() => createTakeIntent({ ...base, deposits: [{ ...deposit(1n), demander: "<img src=x>" }] })).toThrow(/seller address/);
    expect(() => createTakeIntent({ ...base, deposits: [deposit(1n, 0n)] })).toThrow(/zero amount/);
    expect(() => createTakeIntent({ ...base, deposits: [deposit(1n << 64n)] })).toThrow(/out of range/);
    expect(() => createTakeIntent({ ...base, childChain: "Nexus/A/B", deposits: [deposit(1n)] })).toThrow(/direct parent/);
  });
});

describe("page inputs", () => {
  it("accepts only a well-formed child path from the page URL", () => {
    expect(childChainFromQuery("Nexus/Payments")).toEqual(["Nexus", "Payments"]);
    expect(childChainFromQuery("Nexus/A/B")).toEqual(["Nexus", "A", "B"]);
    for (const hostile of [null, "", "Nexus", "Payments/Nexus", "Nexus/<img src=x onerror=alert(1)>", 'Nexus/"onmouseover="x', "Nexus/a b", "Nexus/<b>"]) {
      expect(childChainFromQuery(hostile)).toBeNull();
    }
  });

  it("escapes markup in template text", () => {
    expect(escapeHTML(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  });
});

describe("sell exchange rate", () => {
  const lat = (value: string) => parseAmount(value);

  it("derives the rate from the two amounts and says when it is rounded", () => {
    expect(exchangeRate(lat("2"), lat("3"))).toEqual({ units: lat("1.5"), exact: true });
    expect(exchangeRate(lat("10"), lat("5"))).toEqual({ units: lat("0.5"), exact: true });
    expect(exchangeRate(lat("3"), lat("1"))).toEqual({ units: 33_333_333n, exact: false });
    expect(exchangeRate(lat("3"), lat("2"))).toEqual({ units: 66_666_667n, exact: false });
    expect(() => exchangeRate(0n, lat("1"))).toThrow(/greater than zero/);
  });

  it("turns a typed rate into the amount wanted, never below the rate", () => {
    expect(demandedForRate(lat("2"), lat("1.5"))).toBe(lat("3"));
    expect(demandedForRate(lat("3"), 33_333_333n)).toBe(99_999_999n);
    expect(demandedForRate(3n, lat("0.5"))).toBe(2n); // 1.5 atomic units rounds up
    expect(demandedForRate(1n, 1n)).toBe(1n); // never zero
    expect(() => demandedForRate(lat("1"), 0n)).toThrow(/greater than zero/);
  });

  it("turns a wanted amount into the amount to sell, never above the rate", () => {
    expect(depositedForRate(lat("3"), lat("1.5"))).toBe(lat("2"));
    expect(depositedForRate(lat("1"), lat("3"))).toBe(33_333_333n); // rounded down
    expect(depositedForRate(1n, lat("3"))).toBeNull(); // less than one atomic unit
    expect(() => depositedForRate(lat("1"), 0n)).toThrow(/greater than zero/);
    // Rounding always favours the seller: the effective rate is at least the typed one.
    const sell = depositedForRate(lat("1"), lat("3"))!;
    expect(lat("1") * 100_000_000n >= sell * lat("3")).toBe(true);
  });

  it("an exact typed rate reproduces itself from the resulting amounts", () => {
    for (const [sell, rate] of [["2", "1.5"], ["100", "0.33"], ["0.5", "4"]] as const) {
      const want = demandedForRate(lat(sell), lat(rate));
      expect(exchangeRate(lat(sell), want)).toEqual({ units: lat(rate), exact: true });
    }
  });
});
