import { createSellIntent, demandedForRate, depositedForRate, exchangeRate, parseAmount, parseRate } from "../lib/intent.ts";
import { formatRate } from "../lib/format.ts";
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
          <div><input name="payAmount" inputmode="numeric" placeholder="0" autocomplete="off"/><strong>${childName}</strong></div>
        </label>
        <label class="swap-amount receive-box">
          <span>You want</span>
          <div><input name="receiveAmount" inputmode="numeric" placeholder="0" autocomplete="off"/><strong>${parentName}</strong></div>
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
  // order carries the two amounts only; the rate is never sent. Amounts are
  // whole units, so a field the rate cannot express in whole units is emptied
  // rather than left showing a value the rate no longer describes.
  const sellInput = form.elements.namedItem("payAmount") as HTMLInputElement;
  const wantInput = form.elements.namedItem("receiveAmount") as HTMLInputElement;
  const rateInput = form.elements.namedItem("rate") as HTMLInputElement;
  const note = root.querySelector<HTMLElement>("#rate-note")!;
  const read = (input: HTMLInputElement, parse: (text: string) => bigint): bigint | null => { try { return parse(input.value); } catch { return null; } };
  const explain = () => {
    const sell = read(sellInput, parseAmount), want = read(wantInput, parseAmount);
    note.textContent = sell !== null && want !== null && !exchangeRate(sell, want).exact
      ? "Rounded to whole units. The order uses the two amounts exactly as shown."
      : "";
  };
  const deriveRate = () => {
    const sell = read(sellInput, parseAmount), want = read(wantInput, parseAmount);
    if (sell !== null && want !== null) rateInput.value = formatRate(exchangeRate(sell, want).units);
  };
  /** The amount to sell that `want` implies at `rate`, or an empty field and why. */
  const sellFor = (want: bigint, rate: bigint) => {
    const implied = depositedForRate(want, rate);
    sellInput.value = implied === null ? "" : implied.toString();
    explain();
    if (implied === null) note.textContent = `At this rate, ${want} is worth less than one unit of ${childParts.at(-1)}. Raise the amount you want or lower the rate.`;
  };
  sellInput.addEventListener("input", () => {
    const sell = read(sellInput, parseAmount), rate = read(rateInput, parseRate);
    if (sell !== null && rate !== null) wantInput.value = demandedForRate(sell, rate).toString();
    else deriveRate();
    explain();
  });
  wantInput.addEventListener("input", () => {
    const want = read(wantInput, parseAmount), rate = read(rateInput, parseRate);
    if (want !== null && rate !== null) return sellFor(want, rate);
    if (rate === null) deriveRate();
    explain();
  });
  rateInput.addEventListener("input", () => {
    const sell = read(sellInput, parseAmount), want = read(wantInput, parseAmount), rate = read(rateInput, parseRate);
    if (rate !== null && sell !== null) wantInput.value = demandedForRate(sell, rate).toString();
    else if (rate !== null && want !== null) return sellFor(want, rate);
    explain();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      if (!sellInput.value || !wantInput.value) throw new Error("Enter both the amount you sell and the amount you want.");
      const intent = createSellIntent({ parentChain: parentPath, childChain: childPath, amount: sellInput.value, amountDemanded: wantInput.value });
      renderReview(review, intent, childName, parentName);
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : "The token request could not be staged.";
      error.hidden = false;
    }
  });
}
