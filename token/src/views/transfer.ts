import { createOrderIntent, type OrderIntent, type OrderSide } from "../lib/intent.ts";
import { stageIntent } from "../lib/wallet.ts";
import { escapeHTML, formatLAT } from "../lib/format.ts";
import { walletIntentQR, walletIntentURI } from "../lib/qr.ts";

export function transferView(root: HTMLElement, initialSide: OrderSide, childPath: string): void {
  const childParts = childPath.split("/").filter(Boolean);
  const parentParts = childParts.slice(0, -1);
  const parentPath = parentParts.join("/");
  // Escaped for the templates below; the path itself is validated by the router.
  const childName = escapeHTML(childParts.at(-1) ?? "Child");
  const parentName = escapeHTML(parentParts.at(-1) ?? "Nexus");
  const childAsset = childName;
  const parentAsset = parentName;
  const buy = initialSide === "buy_child";
  const explorerBase = ["127.0.0.1", "localhost"].includes(location.hostname)
    ? "http://127.0.0.1:5174/explorer/"
    : "../explorer/";
  const crumbs = childParts.map((part, index) => {
    const path = childParts.slice(0, index + 1).join("/");
    const url = new URL(explorerBase, location.href);
    url.hash = index === 0 ? "#/" : `#/?c=${encodeURIComponent(path)}`;
    return `<a href="${escapeHTML(url.toString())}">${escapeHTML(part)}</a>`;
  }).join("<span>/</span>");
  root.innerHTML = `
    <section class="simple-exchange">
      <nav class="chain-crumbs" aria-label="Chain path">${crumbs}</nav>
      <header class="simple-intro">
        <h1>${buy ? "Buy" : "Sell"} ${childName}</h1>
        <p>${buy ? `Pay with ${parentName}` : `Receive ${parentName}`}</p>
      </header>

      <form id="exchange-form" class="swap-box" novalidate>
        <label class="swap-amount">
          <span>${buy ? `Pay ${parentName}` : "You sell"}</span>
          <div><input name="payAmount" inputmode="decimal" placeholder="0.00" autocomplete="off"/><strong>${buy ? parentAsset : childAsset}</strong></div>
        </label>

        ${buy ? `
          <p class="amount-choice">or enter the amount you want to receive</p>
          <label class="swap-amount receive-box">
            <span>Receive ${childName}</span>
            <div><input name="receiveAmount" inputmode="decimal" placeholder="0.00" autocomplete="off"/><strong>${childName}</strong></div>
          </label>
        ` : `
          <label class="swap-amount receive-box">
            <span>You want</span>
            <div><input name="receiveAmount" inputmode="decimal" placeholder="0.00" autocomplete="off"/><strong>${parentAsset}</strong></div>
          </label>
        `}

        <input type="hidden" name="side" value="${initialSide}"/>
        <div id="form-error" class="form-error" role="alert" hidden></div>
        <button class="primary wide" type="submit">Continue</button>
        <p class="order-disclaimer">Fees and final approval are shown in your wallet.</p>
      </form>
    </section>
    <section id="review" class="review simple-review" hidden aria-live="polite"></section>`;

  const form = root.querySelector<HTMLFormElement>("#exchange-form")!;
  const error = root.querySelector<HTMLElement>("#form-error")!;
  const review = root.querySelector<HTMLElement>("#review")!;
  const side = initialSide;

  if (buy) {
    const payInput = form.elements.namedItem("payAmount") as HTMLInputElement;
    const receiveInput = form.elements.namedItem("receiveAmount") as HTMLInputElement;
    payInput.addEventListener("input", () => { if (payInput.value) receiveInput.value = ""; });
    receiveInput.addEventListener("input", () => { if (receiveInput.value) payInput.value = ""; });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    const data = new FormData(form);
    try {
      const pay = String(data.get("payAmount") ?? "");
      const receive = String(data.get("receiveAmount") ?? "");
      if (side === "buy_child" && !pay && !receive) throw new Error(`Enter a ${parentParts.at(-1)} or ${childParts.at(-1)} amount.`);
      if (side === "sell_child" && (!pay || !receive)) throw new Error("Enter both the amount you sell and the amount you want.");
      const intent = createOrderIntent({
        parentChain: parentPath, childChain: childPath, side,
        amount: side === "buy_child" && receive ? receive : pay,
        amountBasis: side === "buy_child" && receive ? "child" : "parent",
        ...(side === "sell_child" ? { amountDemanded: receive } : {}),
      });
      stageIntent(intent);
      renderReview(review, intent, childName, parentName);
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : "The token request could not be staged.";
      error.hidden = false;
    }
  });
}

function renderReview(review: HTMLElement, intent: OrderIntent, childName: string, parentName: string): void {
  const sell = intent.side === "sell_child";
  const request = walletIntentURI(intent);
  review.hidden = false;
  review.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Review</p><h2>${sell ? "Sell child" : "Buy child"}</h2></div><span class="status">${intent.orderType}</span></div>
    <dl class="summary compact-summary">
      <div><dt>You pay</dt><dd>${sell ? `${formatLAT(intent.amountDeposited)} ${childName}` : intent.maxAmountDemanded ? `${formatLAT(intent.maxAmountDemanded)} ${parentName}` : `Calculated from available offers`}</dd></div>
      <div><dt>You receive</dt><dd>${sell ? `${formatLAT(intent.amountDemanded)} ${parentName}` : intent.desiredAmountDeposited ? `${formatLAT(intent.desiredAmountDeposited)} ${childName}` : `Calculated from available offers`}</dd></div>
      <div><dt>Receive in</dt><dd>${intent.recipient ? escapeHTML(intent.recipient) : "Account selected in wallet"}</dd></div>
      <div><dt>Fees</dt><dd>Calculated by wallet</dd></div>
    </dl>
    <p class="wallet-boundary">Nothing has been signed. Import this request into your wallet, which will verify it before asking for approval.</p>
    <div id="wallet-handoff" class="qr-handoff" draggable="true" title="Drag this order into an open wallet tab">
      <div><p class="eyebrow">Wallet handoff</p><h3>Drag into wallet</h3><p>Open the wallet in a tab, then drag this card into it. You can also scan or copy the request.</p></div>
      <div class="qr-frame"><span id="qr-loading">Generating QR…</span><img id="wallet-qr" alt="Wallet order request QR code" hidden/></div>
    </div>
    <textarea id="wallet-request" class="wallet-request" readonly aria-label="Wallet request">${request}</textarea>
    <button id="copy-request" class="wide" type="button">Copy wallet request</button>
    <a class="button-link primary wide wallet-open" href="${request}">Open in wallet</a>`;
  review.scrollIntoView({ behavior: "smooth", block: "start" });
  void walletIntentQR(intent).then((url) => {
    const image = review.querySelector<HTMLImageElement>("#wallet-qr")!;
    image.src = url; image.hidden = false; image.draggable = false;
    review.querySelector<HTMLElement>("#qr-loading")!.hidden = true;
  });
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
