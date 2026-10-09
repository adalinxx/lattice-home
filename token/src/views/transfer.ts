import { createSellIntent, demandedForRate, depositedForRate, exchangeRate, parseAmount, parseRate } from "../lib/intent.ts";
import { formatRate } from "../lib/format.ts";
import { crumbsHTML, market, renderReview, sideSwitchHTML } from "./common.ts";

export function sellView(root: HTMLElement, childPath: string): void {
  const { childParts, parentPath, childName, parentName } = market(childPath);
  root.innerHTML = `
    <section class="simple-exchange">
      <nav class="chain-crumbs" aria-label="Chain path">${crumbsHTML(childParts)}</nav>
      ${sideSwitchHTML("sell")}
      <header class="simple-intro">
        <h1>Sell ${childName}</h1>
        <p>Offer ${childName} for ${parentName}. Your ${childName} is locked in the offer, and you are paid when a buyer takes all of it.</p>
      </header>

      <form id="exchange-form" class="swap-box" novalidate>
        <label class="swap-amount">
          <span>You lock</span>
          <div><input name="payAmount" inputmode="numeric" placeholder="0" autocomplete="off"/><strong>${childName}</strong></div>
        </label>
        <label class="swap-amount receive-box">
          <span>You receive if filled</span>
          <div><input name="receiveAmount" inputmode="numeric" placeholder="0" autocomplete="off"/><strong>${parentName}</strong></div>
        </label>
        <label class="swap-amount receive-box">
          <span>Exchange rate</span>
          <div><input name="rate" inputmode="decimal" placeholder="0.00" autocomplete="off"/><strong>${parentName} per ${childName}</strong></div>
        </label>
        <p id="rate-note" class="order-disclaimer" aria-live="polite"></p>

        <div class="offer-terms">
          <p><strong>This is an offer, not an instant exchange.</strong> Approving it in your wallet locks the amount above. You are paid only if a buyer takes the whole offer, which can take any length of time or never happen.</p>
          <p><strong>It cannot be cancelled and does not expire.</strong> The ${childName} stays locked until a buyer takes the offer.</p>
        </div>
        <div id="form-error" class="form-error" role="alert" hidden></div>
        <button class="primary wide" type="submit">Continue</button>
        <p class="order-disclaimer">Fees and final approval are shown in your wallet.</p>
      </form>
    </section>
    <section id="review" class="review simple-review" hidden aria-live="polite"></section>`;

  const form = root.querySelector<HTMLFormElement>("#exchange-form")!;
  const error = root.querySelector<HTMLElement>("#form-error")!;
  const review = root.querySelector<HTMLElement>("#review")!;

  // The order is the two amounts; the rate is a helper and is never sent.
  // An amount the user typed is never rewritten unless they set the rate
  // themselves: until then the rate is derived from the two amounts. Once the
  // user types a rate it stays put and the two amounts follow each other
  // through it, as on an exchange order form; clearing it releases them.
  // Amounts are whole units, so a field the rate cannot express in whole units
  // is emptied rather than left showing a value the rate no longer describes.
  const sellInput = form.elements.namedItem("payAmount") as HTMLInputElement;
  const wantInput = form.elements.namedItem("receiveAmount") as HTMLInputElement;
  const rateInput = form.elements.namedItem("rate") as HTMLInputElement;
  const note = root.querySelector<HTMLElement>("#rate-note")!;
  let rateSet = false; // true only while the rate field holds a rate the user typed
  const read = (input: HTMLInputElement, parse: (text: string) => bigint): bigint | null => { try { return parse(input.value); } catch { return null; } };
  const explain = () => {
    const sell = read(sellInput, parseAmount), want = read(wantInput, parseAmount);
    if (sell === null || want === null) { note.textContent = ""; return; }
    const rate = exchangeRate(sell, want);
    note.textContent = rateSet && rate.units !== read(rateInput, parseRate)
      ? `Whole units only: these amounts work out to a rate of ${rate.exact ? "" : "about "}${formatRate(rate.units)}, not the rate entered. The order uses the two amounts exactly as shown.`
      : rate.exact ? "" : "Rate shown is rounded. The order uses the two amounts exactly as shown.";
  };
  const deriveRate = () => {
    const sell = read(sellInput, parseAmount), want = read(wantInput, parseAmount);
    rateInput.value = sell !== null && want !== null ? formatRate(exchangeRate(sell, want).units) : "";
  };
  /** The amount to lock that `want` implies at `rate`, or an empty field and why. */
  const sellFor = (want: bigint, rate: bigint) => {
    const implied = depositedForRate(want, rate);
    sellInput.value = implied === null ? "" : implied.toString();
    explain();
    if (implied === null) note.textContent = `At this rate, ${want} is worth less than one unit of ${childParts.at(-1)}. Raise the amount you receive or lower the rate.`;
  };
  sellInput.addEventListener("input", () => {
    const sell = read(sellInput, parseAmount), rate = read(rateInput, parseRate);
    if (rateSet && sell !== null && rate !== null) wantInput.value = demandedForRate(sell, rate).toString();
    else if (!rateSet) deriveRate();
    explain();
  });
  wantInput.addEventListener("input", () => {
    const want = read(wantInput, parseAmount), rate = read(rateInput, parseRate);
    if (rateSet && want !== null && rate !== null) return sellFor(want, rate);
    if (!rateSet) deriveRate();
    explain();
  });
  rateInput.addEventListener("input", () => {
    const sell = read(sellInput, parseAmount), want = read(wantInput, parseAmount), rate = read(rateInput, parseRate);
    rateSet = rate !== null;
    if (rate !== null && sell !== null) wantInput.value = demandedForRate(sell, rate).toString();
    else if (rate !== null && want !== null) return sellFor(want, rate);
    explain();
  });

  // A staged request describes the form as it was. Any edit withdraws it, so
  // the card, QR and copy button can never offer terms the form no longer shows.
  const withdraw = () => { review.hidden = true; review.replaceChildren(); };
  form.addEventListener("input", withdraw);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    withdraw();
    try {
      if (!sellInput.value || !wantInput.value) throw new Error("Enter both the amount you lock and the amount you receive.");
      const intent = createSellIntent({ parentChain: parentPath, childChain: childPath, amount: sellInput.value, amountDemanded: wantInput.value });
      renderReview(review, intent, childName, parentName);
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : "The token request could not be staged.";
      error.hidden = false;
    }
  });
}
