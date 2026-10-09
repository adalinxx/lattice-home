import type { OrderIntent } from "../lib/intent.ts";
import { escapeHTML, formatUnits } from "../lib/format.ts";
import { walletIntentQR, walletIntentURI } from "../lib/qr.ts";

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

/** The handoff: what was staged, and the request to drag, scan or copy. */
export function renderReview(review: HTMLElement, intent: OrderIntent, childName: string, parentName: string): void {
  const sell = intent.side === "sell_child";
  const request = walletIntentURI(intent);
  const pay = sell ? intent.amountDeposited : intent.deposits.reduce((sum, deposit) => sum + BigInt(deposit.amountDemanded), 0n).toString();
  const receive = sell ? intent.amountDemanded : intent.deposits.reduce((sum, deposit) => sum + BigInt(deposit.amountDeposited), 0n).toString();
  review.hidden = false;
  review.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Review</p><h2>${sell ? "Sell child" : "Buy child"}</h2></div><span class="status">${sell ? "limit" : `${intent.deposits.length} selected`}</span></div>
    <dl class="summary compact-summary">
      <div><dt>You pay</dt><dd>${formatUnits(pay)} ${sell ? childName : parentName}</dd></div>
      <div><dt>You receive</dt><dd>${formatUnits(receive)} ${sell ? parentName : childName}</dd></div>
      <div><dt>Receive in</dt><dd>Account selected in wallet</dd></div>
      <div><dt>Fees</dt><dd>Calculated by wallet</dd></div>
    </dl>
    <p class="wallet-boundary">Nothing has been signed. Import this request into your wallet, which will verify it before asking for approval.</p>
    <div id="wallet-handoff" class="qr-handoff" draggable="true" title="Drag this order into an open wallet tab">
      <div><p class="eyebrow">Wallet handoff</p><h3>Drag into wallet</h3><p>Open the wallet in a tab, then drag this card into it. You can also scan or copy the request.</p></div>
      <div class="qr-frame"><span id="qr-loading">Generating QR…</span><img id="wallet-qr" alt="Wallet order request QR code" hidden/></div>
    </div>
    <textarea id="wallet-request" class="wallet-request" readonly aria-label="Wallet request">${escapeHTML(request)}</textarea>
    <button id="copy-request" class="primary wide" type="button">Copy wallet request</button>`;
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
