import { describe, expect, it } from "vitest";
import { createOrderIntent, isAdjacent, parseAmount, parseChainPath, routeBetween } from "./intent.ts";

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
      amount: "2", limitPrice: "1.5",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(intent.side).toBe("sell_child");
    if (intent.side !== "sell_child") throw new Error("expected sell intent");
    expect(intent.amountDeposited).toBe("200000000");
    expect(intent.amountDemanded).toBe("300000000");
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
