import { describe, expect, it } from "vitest";
import { childChainFromQuery, createSellIntent, createTakeIntent, demandedForRate, depositedForRate, exchangeRate, isAdjacent, parseAmount, parseChainPath, parseRate, routeBetween } from "./intent.ts";
import { escapeHTML, formatRate, formatUnits } from "./format.ts";

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
  it("reads amounts as whole units within UInt64, as the wallet and explorer show them", () => {
    expect(parseAmount("3")).toBe(3n);
    expect(parseAmount(" 300000000 ")).toBe(300_000_000n);
    expect(parseAmount("18446744073709551615")).toBe(18446744073709551615n);
    for (const bad of ["", "0", "-1", "1.5", "0.5", "1e3", "0x10", "01", "1,000"]) expect(() => parseAmount(bad)).toThrow();
    expect(() => parseAmount("18446744073709551616")).toThrow(/larger than a chain can hold/);
    expect(formatUnits(300000000n)).toBe("300,000,000");
    expect(formatUnits("18446744073709551615")).toBe("18,446,744,073,709,551,615");
  });

  it("reads a rate to 8 decimal places and prints it back", () => {
    expect(parseRate("1.5")).toBe(150_000_000n);
    expect(parseRate("0.00000001")).toBe(1n);
    expect(formatRate(150_000_000n)).toBe("1.5");
    expect(formatRate(33_333_333n)).toBe("0.33333333");
    expect(formatRate(300_000_000n)).toBe("3");
    for (const bad of ["", "0", "0.000000001", "abc", "-1", "1e3"]) expect(() => parseRate(bad)).toThrow();
  });

  it("requires rooted chain paths", () => {
    expect(parseChainPath("Nexus/Payments")).toEqual(["Nexus", "Payments"]);
    expect(() => parseChainPath("Payments")).toThrow(/begin with Nexus/);
  });

  it("maps a limit sell to exact deposit terms", () => {
    const intent = createSellIntent({
      parentChain: "Nexus", childChain: "Nexus/Payments", amount: "200", amountDemanded: "300",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(intent).toMatchObject({ side: "sell_child", orderType: "limit", amountDeposited: "200", amountDemanded: "300", expiresAt: "2026-01-01T00:15:00.000Z" });
    expect(Object.keys(intent).sort()).toEqual(["amountDemanded", "amountDeposited", "asset", "childChain", "expiresAt", "intentId", "orderType", "parentChain", "side", "version"]);
  });

  it("keeps both sell amounts exactly as typed, whatever their ratio", () => {
    const sell = (amount: string, amountDemanded: string) => {
      const intent = createSellIntent({ parentChain: "Nexus", childChain: "Nexus/Payments", amount, amountDemanded });
      return [intent.amountDeposited, intent.amountDemanded];
    };
    expect(sell("3", "1")).toEqual(["3", "1"]);
    expect(sell("7", "2")).toEqual(["7", "2"]);
    expect(sell("300000000", "30000000")).toEqual(["300000000", "30000000"]);
    expect(sell("18446744073709551615", "18446744073709551615")).toEqual(["18446744073709551615", "18446744073709551615"]);
  });

  it("refuses a sell the wallet would have to reject", () => {
    const base = { parentChain: "Nexus", childChain: "Nexus/Payments", amount: "2" };
    expect(() => createSellIntent({ ...base, amountDemanded: "" })).toThrow(/whole number/);
    expect(() => createSellIntent({ ...base, amountDemanded: "0" })).toThrow(/greater than zero/);
    expect(() => createSellIntent({ ...base, amountDemanded: "1.5" })).toThrow(/whole number/);
    // One past UInt64, on either side of the order.
    expect(() => createSellIntent({ ...base, amount: "18446744073709551616", amountDemanded: "1" })).toThrow(/larger than a chain can hold/);
    expect(() => createSellIntent({ ...base, amountDemanded: "18446744073709551616" })).toThrow(/larger than a chain can hold/);
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
  it("derives the rate from the two amounts and says when it is rounded", () => {
    expect(exchangeRate(2n, 3n)).toEqual({ units: parseRate("1.5"), exact: true });
    expect(exchangeRate(10n, 5n)).toEqual({ units: parseRate("0.5"), exact: true });
    expect(exchangeRate(3n, 1n)).toEqual({ units: 33_333_333n, exact: false });
    expect(exchangeRate(3n, 2n)).toEqual({ units: 66_666_667n, exact: false });
    expect(() => exchangeRate(0n, 1n)).toThrow(/greater than zero/);
  });

  it("turns a typed rate into the amount wanted, never below the rate", () => {
    expect(demandedForRate(2n, parseRate("1.5"))).toBe(3n);
    expect(demandedForRate(3n, parseRate("0.5"))).toBe(2n); // 1.5 rounds up
    expect(demandedForRate(1n, 1n)).toBe(1n); // never zero
    expect(() => demandedForRate(1n, 0n)).toThrow(/greater than zero/);
  });

  it("turns a wanted amount into the amount to sell, never above the rate", () => {
    expect(depositedForRate(3n, parseRate("1.5"))).toBe(2n);
    expect(depositedForRate(10n, parseRate("3"))).toBe(3n); // rounded down
    // Rounding always favours the seller: the effective rate is at least the typed one.
    expect(10n * 100_000_000n >= 3n * parseRate("3")).toBe(true);
    expect(() => depositedForRate(1n, 0n)).toThrow(/greater than zero/);
  });

  it("has no whole amount to sell when the wanted amount is worth less than one unit", () => {
    // Sell 1 at rate 3, then want 1: a third of a unit. The form must empty the
    // sell field here, not keep the old 1 beside a rate it no longer matches.
    expect(depositedForRate(1n, parseRate("3"))).toBeNull();
    expect(depositedForRate(2n, parseRate("3"))).toBeNull();
    expect(depositedForRate(3n, parseRate("3"))).toBe(1n);
  });

  it("an exact typed rate reproduces itself from the resulting amounts", () => {
    for (const [sell, rate] of [[2n, "1.5"], [100n, "0.33"], [5n, "4"]] as const) {
      const want = demandedForRate(sell, parseRate(rate));
      expect(exchangeRate(sell, want)).toEqual({ units: parseRate(rate), exact: true });
    }
  });
});
