import { stagedIntent } from "../lib/wallet.ts";
import { formatLAT } from "../lib/format.ts";

export function statusView(root: HTMLElement): void {
  const intent = stagedIntent();
  let receipt: { transferId: string; status: string } | null = null;
  try {
    const raw = sessionStorage.getItem("lattice-exchange:last-transfer");
    receipt = raw ? JSON.parse(raw) as { transferId: string; status: string } : null;
  } catch { /* no status */ }

  root.innerHTML = `
    <section class="page-intro">
      <p class="eyebrow">Order status</p>
      <h1>${receipt ? "Handed to wallet" : "No active order"}</h1>
      <p>${receipt ? "Your wallet is now the source of truth for signing, submission, and settlement." : "Stage an order to begin."}</p>
    </section>
    ${intent ? `
      <section class="status-panel">
        <div class="progress-row"><span class="progress-dot complete"></span><span>Intent staged</span></div>
        <div class="progress-row"><span class="progress-dot ${receipt ? "complete" : ""}"></span><span>Wallet handoff</span></div>
        <div class="progress-row"><span class="progress-dot"></span><span>${intent.side === "sell_child" ? "Child deposit listed" : "Receipt and child withdrawal"}</span></div>
        <dl class="summary">
          <div><dt>Market</dt><dd>${intent.childChain.join(" / ")} / ${intent.parentChain.join(" / ")}</dd></div>
          <div><dt>Order</dt><dd>${intent.side === "sell_child" ? "Sell child · limit" : "Buy child · market"}</dd></div>
          <div><dt>Amount</dt><dd>${intent.side === "sell_child"
            ? `${formatLAT(intent.amountDeposited)} child token`
            : intent.maxAmountDemanded
              ? `${formatLAT(intent.maxAmountDemanded)} parent token`
              : `${formatLAT(intent.desiredAmountDeposited!)} child token`}</dd></div>
          ${receipt ? `<div><dt>Wallet reference</dt><dd class="mono break">${receipt.transferId}</dd></div>` : ""}
        </dl>
      </section>` : `<a class="button-link primary" href="#/payments/buy">Stage an order</a>`}
  `;
}
