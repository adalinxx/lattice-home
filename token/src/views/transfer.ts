import { createSellIntent, demandedForRate, depositedForRate, exchangeRate, parseAmount } from "../lib/intent.ts";
import { stageIntent } from "../lib/wallet.ts";
import { formatLAT } from "../lib/format.ts";
import { crumbsHTML, market, renderReview } from "./common.ts";

export function sellView(root: HTMLElement, childPath: string): void {
  const { childParts, parentPath, childName, parentName } = market(childPath);
  root.innerHTML = `
    <section class="simple-exchange">
      <nav class="chain-crumbs" aria-label="Chain path">${crumbsHTML(childParts)}</nav>
      <header class="simple-intro">
        <h1>Sell ${childName}</h1>
        <p>Receive ${parentName}</p>
      </header>

      <form id="exchange-form" class="swap-box" novalidate>
        <label class="swap-amount">
          <span>You sell</span>
          <div><input name="payAmount" inputmode="decimal" placeholder="0.00" autocomplete="off"/><strong>${childName}</strong></div>
        </label>
        <label class="swap-amount receive-box">
          <span>You want</span>
          <div><input name="receiveAmount" inputmode="decimal" placeholder="0.00" autocomplete="off"/><strong>${parentName}</strong></div>
        </label>
        <label class="swap-amount receive-box">
          <span>Exchange rate</span>
          <div><input name="rate" inputmode="decimal" placeholder="0.00" autocomplete="off"/><strong>${parentName} per ${childName}</strong></div>
        </label>
        <p id="rate-note" class="order-disclaimer" aria-live="polite"></p>

        <div id="form-error" class="form-error" role="alert" hidden></div>
        <button class="primary wide" type="submit">Continue</button>
        <p class="order-disclaimer">Fees and final approval are shown in your wallet.</p>
      </form>
    </section>
    <section id="review" class="review simple-review" hidden aria-live="polite"></section>`;

  const form = root.querySelector<HTMLFormElement>("#exchange-form")!;
  const error = root.querySelector<HTMLElement>("#form-error")!;
  const review = root.querySelector<HTMLElement>("#review")!;

  // Price, amount and total as on an exchange order form: the rate stays put
  // once it is set, and the two amounts follow each other through it. The
  // order carries the two amounts only; the rate is never sent.
  const sellInput = form.elements.namedItem("payAmount") as HTMLInputElement;
  const wantInput = form.elements.namedItem("receiveAmount") as HTMLInputElement;
  const rateInput = form.elements.namedItem("rate") as HTMLInputElement;
  const note = root.querySelector<HTMLElement>("#rate-note")!;
  const units = (input: HTMLInputElement): bigint | null => { try { return parseAmount(input.value); } catch { return null; } };
  const show = (input: HTMLInputElement, value: bigint) => { input.value = formatLAT(value.toString()); };
  const explain = () => {
    const sell = units(sellInput), want = units(wantInput);
    note.textContent = sell !== null && want !== null && !exchangeRate(sell, want).exact
      ? "Rounded to whole units. The order uses the two amounts exactly as shown."
      : "";
  };
  const deriveRate = () => {
    const sell = units(sellInput), want = units(wantInput);
    if (sell !== null && want !== null) show(rateInput, exchangeRate(sell, want).units);
  };
  sellInput.addEventListener("input", () => {
    const sell = units(sellInput), rate = units(rateInput);
    if (sell !== null && rate !== null) show(wantInput, demandedForRate(sell, rate));
    else deriveRate();
    explain();
  });
  wantInput.addEventListener("input", () => {
    const want = units(wantInput), rate = units(rateInput);
    const sell = want !== null && rate !== null ? depositedForRate(want, rate) : null;
    if (sell !== null) show(sellInput, sell);
    else if (rate === null) deriveRate();
    explain();
  });
  rateInput.addEventListener("input", () => {
    const sell = units(sellInput), want = units(wantInput), rate = units(rateInput);
    if (rate !== null && sell !== null) show(wantInput, demandedForRate(sell, rate));
    else if (rate !== null && want !== null) { const implied = depositedForRate(want, rate); if (implied !== null) show(sellInput, implied); }
    explain();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      if (!sellInput.value || !wantInput.value) throw new Error("Enter both the amount you sell and the amount you want.");
      const intent = createSellIntent({ parentChain: parentPath, childChain: childPath, amount: sellInput.value, amountDemanded: wantInput.value });
      stageIntent(intent);
      renderReview(review, intent, childName, parentName);
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : "The token request could not be staged.";
      error.hidden = false;
    }
  });
}
