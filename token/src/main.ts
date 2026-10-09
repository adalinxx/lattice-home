import "./style.css";
import { sellView } from "./views/transfer.ts";
import { buyView } from "./views/buy.ts";
import { statusView } from "./views/status.ts";
import { childChainFromQuery } from "./lib/intent.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
const homeUrl = ["127.0.0.1", "localhost"].includes(location.hostname)
  ? "http://127.0.0.1:5174/"
  : "../";

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="${homeUrl}" aria-label="Lattice home">
      <img src="./assets/lattice-mark.svg" alt="" width="24" height="24" />
      <span class="wordmark">Lattice</span><span class="brand-sub">Token</span>
    </a>
  </header>
  <main id="view"></main>
  <footer>
    <span>Lattice Token</span>
    <span>Stages orders. Wallets complete settlement.</span>
  </footer>
`;

const view = document.querySelector<HTMLElement>("#view")!;
function selectedChildPath(): string {
  const parts = childChainFromQuery(new URLSearchParams(location.search).get("chain"));
  return parts ? parts.join("/") : "Nexus/Payments";
}

function route(): void {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const name = parts[0] === "status" ? "status" : (parts[1] === "sell" ? "sell" : "buy");
  if (name === "status") statusView(view);
  else if (name === "sell") sellView(view, selectedChildPath());
  else buyView(view, selectedChildPath());
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
