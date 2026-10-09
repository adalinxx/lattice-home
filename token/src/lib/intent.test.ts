import { describe, expect, it } from "vitest";
import { childChainFromQuery, createOrderIntent, isAdjacent, parseAmount, parseChainPath, routeBetween } from "./intent.ts";
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
    const intent = createOrderIntent({
      parentChain: "Nexus", childChain: "Nexus/Payments", side: "sell_child",
      amount: "2", amountDemanded: "3",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(intent.side).toBe("sell_child");
    if (intent.side !== "sell_child") throw new Error("expected sell intent");
    expect(intent.amountDeposited).toBe("200000000");
    expect(intent.amountDemanded).toBe("300000000");
  });

  it("keeps both sell amounts exactly as typed, whatever their ratio", () => {
    const sell = (amount: string, amountDemanded: string) => {
      const intent = createOrderIntent({ parentChain: "Nexus", childChain: "Nexus/Payments", side: "sell_child", amount, amountDemanded });
      if (intent.side !== "sell_child") throw new Error("expected sell intent");
      return [intent.amountDeposited, intent.amountDemanded];
    };
    // Ratios with no short decimal form: a derived price cannot express them.
    expect(sell("3", "0.3")).toEqual(["300000000", "30000000"]);
    expect(sell("3", "1")).toEqual(["300000000", "100000000"]);
    expect(sell("7", "2")).toEqual(["700000000", "200000000"]);
    expect(sell("0.1", "0.3")).toEqual(["10000000", "30000000"]);
    expect(sell("0.00000003", "0.00000001")).toEqual(["3", "1"]);
  });

  it("refuses a sell without a demanded amount", () => {
    const base = { parentChain: "Nexus", childChain: "Nexus/Payments", side: "sell_child" as const, amount: "2" };
    expect(() => createOrderIntent(base)).toThrow(/amount/);
    expect(() => createOrderIntent({ ...base, amountDemanded: "0" })).toThrow(/greater than zero/);
  });

  it("maps a market buy to a maximum parent spend", () => {
    const intent = createOrderIntent({
      parentChain: "Nexus", childChain: "Nexus/Payments", side: "buy_child",
      amount: "3",
    });
    expect(intent.side).toBe("buy_child");
    if (intent.side !== "buy_child") throw new Error("expected buy intent");
    expect(intent.maxAmountDemanded).toBe("300000000");
  });

  it("maps a child amount to a market-buy target", () => {
    const intent = createOrderIntent({
      parentChain: "Nexus", childChain: "Nexus/Payments", side: "buy_child",
      amount: "4", amountBasis: "child",
    });
    expect(intent.side).toBe("buy_child");
    if (intent.side !== "buy_child") throw new Error("expected buy intent");
    expect(intent.desiredAmountDeposited).toBe("400000000");
    expect(intent.maxAmountDemanded).toBeUndefined();
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
