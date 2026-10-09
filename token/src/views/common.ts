import type { OrderIntent } from "../lib/intent.ts";
import { escapeHTML, formatUnits } from "../lib/format.ts";
import { walletIntentQR, walletIntentURI } from "../lib/qr.ts";
import { WALLET_URL } from "../lib/config.ts";

/** The chain a page is about, with names escaped for the HTML templates. */
export function market(childPath: string) {
  const childParts = childPath.split("/").filter(Boolean);
  const parentParts = childParts.slice(0, -1);
  return {
    childParts, parentParts, parentPath: parentParts.join("/"),
    childName: escapeHTML(childParts.at(-1) ?? "Child"),
    parentName: escapeHTML(parentParts.at(-1) ?? "Nexus"),
  };
}

export function crumbsHTML(childParts: readonly string[]): string {
  const explorerBase = ["127.0.0.1", "localhost"].includes(location.hostname) ? "http://127.0.0.1:5174/explorer/" : "../explorer/";
  return childParts.map((part, index) => {
    const url = new URL(explorerBase, location.href);
    url.hash = index === 0 ? "#/" : `#/?c=${encodeURIComponent(childParts.slice(0, index + 1).join("/"))}`;
    return `<a href="${escapeHTML(url.toString())}">${escapeHTML(part)}</a>`;
  }).join("<span>/</span>");
}

/** Buy and Sell for the same chain, one of them current. The chain stays in
 * the query string; only the route changes. */
export function sideSwitchHTML(current: "buy" | "sell"): string {
  const tab = (side: "buy" | "sell", label: string) =>
    `<a href="${escapeHTML(location.search)}#/market/${side}"${side === current ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="side-switch" aria-label="Buy or sell">${tab("buy", "Buy")}${tab("sell", "Sell")}</nav>`;
}

/** The handoff: what was staged, how to finish it in the wallet, and the
 * request to drag, scan or copy. */
export function renderReview(review: HTMLElement, intent: OrderIntent, childName: string, parentName: string): void {
  const sell = intent.side === "sell_child";
  const request = walletIntentURI(intent);
  const pay = sell ? intent.amountDeposited : intent.deposits.reduce((sum, deposit) => sum + BigInt(deposit.amountDemanded), 0n).toString();
  const receive = sell ? intent.amountDemanded : intent.deposits.reduce((sum, deposit) => sum + BigInt(deposit.amountDeposited), 0n).toString();
  review.hidden = false;
  review.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Review</p><h2>${sell ? "Sell offer" : "Purchase"}</h2></div><span class="status">${sell ? "not yet locked" : `${intent.deposits.length} selected`}</span></div>
    <dl class="summary compact-summary">
      <div><dt>${sell ? "You lock" : "You pay"}</dt><dd>${formatUnits(pay)} ${sell ? childName : parentName}</dd></div>
      <div><dt>${sell ? "You receive if filled" : "You receive"}</dt><dd>${formatUnits(receive)} ${sell ? parentName : childName}</dd></div>
      <div><dt>${sell ? "Paid to" : "Receive in"}</dt><dd>Account selected in wallet</dd></div>
      <div><dt>Fees</dt><dd>Calculated by wallet</dd></div>
    </dl>
    <p class="wallet-boundary">Nothing has been signed or locked. This page only prepared a request; Lattice Wallet checks it and asks for your approval.</p>
    <div class="handoff-steps">
      <h3>Finish in Lattice Wallet</h3>
      <ol>
        <li>Open Lattice Wallet in your computer's browser. <a href="${WALLET_URL}" target="_blank" rel="noopener noreferrer">Get Lattice Wallet</a></li>
        <li>In the wallet, open Settings (the Lattice mark) and choose <strong>Open cross-chain order</strong>.</li>
        <li>Give it this request in any one way: copy it below and paste it into the wallet's text box, then press <strong>Use pasted text</strong>; or scan this QR code from the wallet; or drag the card onto the wallet's tab.</li>
        <li>Check the terms the wallet shows and approve there.</li>
      </ol>
      <p class="touch-only">On a phone or tablet: the wallet is a desktop browser extension. Scan this code from the wallet on your computer, or copy the request and send it to that computer.</p>
      ${sell ? "" : `<p>Buying selected sell orders needs a wallet version that supports it. An older wallet answers "The order side or type is unsupported"; update it and try again.</p>`}
    </div>
    <button id="copy-request" class="primary wide" type="button">Copy wallet request</button>
    <textarea id="wallet-request" class="wallet-request" readonly aria-label="Wallet request">${escapeHTML(request)}</textarea>
    <div id="wallet-handoff" class="qr-handoff" draggable="true" title="Drag this card onto an open Lattice Wallet tab">
      <div><p class="eyebrow">Same request</p><h3>Scan or drag</h3><p>Scan from the wallet's camera, or drag this card onto the wallet's tab.</p></div>
      <div class="qr-frame"><span id="qr-loading">Generating QR…</span><img id="wallet-qr" alt="Wallet order request QR code" hidden/></div>
    </div>`;
  review.scrollIntoView({ behavior: "smooth", block: "start" });
  const loading = review.querySelector<HTMLElement>("#qr-loading")!;
  void walletIntentQR(intent).then((url) => {
    const image = review.querySelector<HTMLImageElement>("#wallet-qr")!;
    image.src = url; image.hidden = false; image.draggable = false;
    loading.hidden = true;
  }).catch(() => { loading.textContent = "Too large for one QR code. Drag or copy the request instead."; });
  const handoff = review.querySelector<HTMLElement>("#wallet-handoff")!;
  handoff.addEventListener("dragstart", (event) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-lattice-order", request);
    event.dataTransfer.setData("text/plain", request);
    event.dataTransfer.setData("text/uri-list", request);
    handoff.classList.add("dragging");
  });
  handoff.addEventListener("dragend", () => handoff.classList.remove("dragging"));
  review.querySelector("#copy-request")!.addEventListener("click", async () => {
    await navigator.clipboard.writeText(request);
    review.querySelector("#copy-request")!.textContent = "Copied";
  });
}
