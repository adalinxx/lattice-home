// Buy: the child chain's open sell orders, cheapest first, for the user to
// tick. The list is the node's word and only a convenience. The wallet proves
// every selected deposit and that nobody has paid for it before it signs.

import { createTakeIntent, exchangeRate } from "../lib/intent.ts";
import { confirmations, depositKey, totals, type Deposit } from "../lib/deposits.ts";
import { endpointFor, listDeposits, nextOpenDeposits } from "../lib/node.ts";
import { WALLET_REQUEST_MAX } from "../lib/config.ts";
import { formatRate, formatUnits, shorten } from "../lib/format.ts";
import { walletIntentURI } from "../lib/qr.ts";
import { crumbsHTML, market, renderReview } from "./common.ts";

const PAGE = 20;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function buyView(root: HTMLElement, childPath: string): void {
  const { childParts, parentParts, parentPath, childName, parentName } = market(childPath);
  root.innerHTML = `
    <section class="simple-exchange offer-page">
      <nav class="chain-crumbs" aria-label="Chain path">${crumbsHTML(childParts)}</nav>
      <header class="simple-intro">
        <h1>Buy ${childName}</h1>
        <p>Pay with ${parentName}. Choose the sell orders you want; each is bought whole.</p>
      </header>
      <div class="offer-box">
        <div class="offer-head">
          <span id="offer-status" role="status" aria-live="polite">Finding sell orders…</span>
          <button id="offer-refresh" type="button">Refresh</button>
        </div>
        <div class="offer-row offer-labels" aria-hidden="true">
          <span></span><span>You receive · ${childName}</span><span>You pay · ${parentName}</span><span>Rate · ${parentName} per ${childName}</span><span>Confirmations</span>
        </div>
        <div id="offer-list" class="offer-list"></div>
        <button id="offer-more" class="wide" type="button" hidden>Show more</button>
        <p class="order-disclaimer">This list comes from the chain's node and is not verified here. Your wallet checks every selected order before you approve a payment. Orders already paid for by someone else are left out. Confirmations count the blocks the node reports on top of an order's own block.</p>
      </div>
    </section>
    <section id="review" class="review simple-review" hidden aria-live="polite"></section>
    <div class="offer-bar" role="region" aria-label="Your selection">
      <div class="offer-bar-inner">
        <div id="form-error" class="form-error" role="alert" hidden></div>
        <div class="offer-summary">
          <span id="offer-total" aria-live="polite">Nothing selected</span>
          <button id="offer-continue" class="primary" type="button" disabled>Continue</button>
        </div>
      </div>
    </div>`;

  const status = root.querySelector<HTMLElement>("#offer-status")!;
  const list = root.querySelector<HTMLElement>("#offer-list")!;
  const more = root.querySelector<HTMLButtonElement>("#offer-more")!;
  const refresh = root.querySelector<HTMLButtonElement>("#offer-refresh")!;
  const total = root.querySelector<HTMLElement>("#offer-total")!;
  const proceed = root.querySelector<HTMLButtonElement>("#offer-continue")!;
  const error = root.querySelector<HTMLElement>("#form-error")!;
  const review = root.querySelector<HTMLElement>("#review")!;
  const parentLabel = parentParts.at(-1) ?? "Nexus", childLabel = childParts.at(-1) ?? "Child";

  const selected = new Map<string, Deposit>();
  let sorted: Deposit[] = [], cursor = 0, shown = 0, truncated = false;
  let parentNode = "", load = 0;
  let tipHeight: bigint | null = null, unusable = 0;

  const fail = (caught: unknown) => {
    error.textContent = caught instanceof Error ? caught.message : "The sell orders could not be read.";
    error.hidden = false;
  };

  const summarize = () => {
    const chosen = [...selected.values()];
    proceed.disabled = chosen.length === 0;
    if (chosen.length === 0) { total.textContent = "Nothing selected"; return; }
    const { pay, receive } = totals(chosen);
    total.textContent = `${chosen.length} selected · pay ${formatUnits(pay)} ${parentLabel} · receive ${formatUnits(receive)} ${childLabel}`;
  };

  const row = (deposit: Deposit): HTMLElement => {
    const key = depositKey(deposit);
    const line = el("label", "offer-row");
    const box = el("input");
    box.type = "checkbox";
    box.checked = selected.has(key);
    box.setAttribute("aria-label", `Sell order from ${deposit.demander}`);
    box.addEventListener("change", () => {
      if (box.checked) selected.set(key, deposit); else selected.delete(key);
      review.hidden = true;
      summarize();
    });
    const rate = exchangeRate(deposit.amountDeposited, deposit.amountDemanded);
    const receive = el("span", "offer-amount", formatUnits(deposit.amountDeposited));
    const seller = el("small", "", `from ${shorten(deposit.demander, 8, 6)}`);
    seller.title = deposit.demander;
    receive.append(seller);
    line.append(box, receive,
      el("span", "offer-amount", formatUnits(deposit.amountDemanded)),
      el("span", "offer-amount", `${rate.exact ? "" : "≈ "}${formatRate(rate.units)}`));
    const depth = confirmations(deposit, tipHeight);
    const confirmed = el("span", "offer-amount offer-confirmations", depth === null ? "—" : depth.toString());
    confirmed.title = depth === null ? "The node did not report this order's block."
      : `In block ${deposit.blockHeight} (${deposit.blockHash}), as reported by the node.`;
    line.append(confirmed);
    return line;
  };

  const showMore = async () => {
    const run = load;
    more.disabled = true;
    try {
      const page = await nextOpenDeposits(parentNode, childParts, sorted, cursor, PAGE);
      if (run !== load) return;
      cursor = page.next;
      shown += page.open.length;
      for (const deposit of page.open) list.append(row(deposit));
      const done = cursor >= sorted.length;
      more.hidden = done;
      status.textContent = shown === 0 && done ? "No open sell orders."
        : `${shown} open sell order${shown === 1 ? "" : "s"}${done ? "" : " shown"}, cheapest first${truncated && done ? " (the node listed more than this page reads)" : ""}${unusable ? `. ${unusable} listed order${unusable === 1 ? " is" : "s are"} left out: a wallet could not buy ${unusable === 1 ? "it" : "them"} as given` : ""}`;
    } catch (caught) {
      if (run === load) { fail(caught); status.textContent = "Could not check which orders are still open."; more.hidden = false; }
    } finally {
      if (run === load) more.disabled = false;
    }
  };

  const reload = async () => {
    const run = ++load;
    selected.clear(); sorted = []; cursor = 0; shown = 0;
    list.replaceChildren(); more.hidden = true; error.hidden = true; review.hidden = true;
    summarize();
    status.textContent = "Finding sell orders…";
    refresh.disabled = true;
    try {
      const [childNode, parent] = await Promise.all([endpointFor(childParts), endpointFor(parentParts)]);
      const listing = await listDeposits(childNode, childParts);
      if (run !== load) return;
      parentNode = parent; sorted = listing.deposits; truncated = listing.truncated; tipHeight = listing.tipHeight; unusable = listing.unusable;
      await showMore();
    } catch (caught) {
      if (run === load) { fail(caught); status.textContent = "Sell orders unavailable."; }
    } finally {
      if (run === load) refresh.disabled = false;
    }
  };

  more.addEventListener("click", () => { void showMore(); });
  refresh.addEventListener("click", () => { void reload(); });
  proceed.addEventListener("click", () => {
    error.hidden = true;
    try {
      const intent = createTakeIntent({ parentChain: parentPath, childChain: childPath, deposits: [...selected.values()] });
      if (walletIntentURI(intent).length > WALLET_REQUEST_MAX) throw new Error("That is more sell orders than one wallet request can carry. Select fewer and buy the rest afterwards.");
      renderReview(review, intent, childName, parentName);
    } catch (caught) { fail(caught); }
  });
  void reload();
}
