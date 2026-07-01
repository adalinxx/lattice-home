"use strict";

/* ------------------------------------------------------------------ *
 * Lattice Explorer — a trustless, fully client-side block explorer.
 * The browser talks to the node's HTTP RPC directly; there is no
 * backend. All routing is hash-based so it works on static hosting.
 * ------------------------------------------------------------------ */

const CFG = window.LATTICE_CONFIG;

// One or more interchangeable nodes (same chain/genesis). Requests start at the
// active node and fail over to the next on transport failure or a 5xx; the
// active index is sticky so we stay on a healthy node once we find one.
const NODES = (CFG.nodeUrls && CFG.nodeUrls.length ? CFG.nodeUrls : [CFG.nodeUrl]).map((u) => u.replace(/\/$/, ""));
let nodeIdx = 0;
const activeNode = () => NODES[nodeIdx];
function rotateNode() {
  if (NODES.length > 1) nodeIdx = (nodeIdx + 1) % NODES.length;
  const nl = $("#node-link");
  if (nl) nl.href = activeNode();
}

const state = {
  chain: sessionStorage.getItem("chain") || null, // slash-joined chain path; null = node default (Nexus)
  chains: [],
};

/* ---------------------------- HTTP ------------------------------- */

function buildUrl(base, path, params) {
  const url = new URL(base + path);
  if (state.chain) url.searchParams.set("chainPath", state.chain);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url;
}

async function api(path, params) {
  let lastErr;
  // At most one attempt per node: a healthy node returns (incl. 4xx like 404,
  // which is a valid answer — never a reason to fail over); only a dead node or
  // a 5xx advances to the next.
  for (let attempt = 0; attempt < NODES.length; attempt++) {
    let res;
    try {
      res = await fetch(buildUrl(activeNode(), path, params), { headers: { Accept: "application/json" } });
    } catch (e) {
      lastErr = e;
      rotateNode();
      continue;
    }
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (res.ok) return body;
    if (res.status >= 500 && attempt < NODES.length - 1) {
      lastErr = new Error(body && body.error ? body.error : `HTTP ${res.status}`);
      rotateNode();
      continue;
    }
    const e = new Error(body && body.error ? body.error : `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  throw lastErr || new Error("All nodes unreachable");
}

/* --------------------------- helpers ----------------------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    // Coerce primitives (numbers, booleans) to text — appendChild only accepts
    // Nodes, so a raw number child would otherwise throw and abort the render.
    n.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = (s, head = 10, tail = 8) =>
  !s ? "" : s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
const num = (n) => (n == null ? "—" : Number(n).toLocaleString());
const fmtTime = (ms) => (ms == null ? "—" : new Date(Number(ms)).toLocaleString());
const ago = (ms) => {
  if (ms == null) return "";
  const d = Math.max(0, Date.now() - Number(ms)) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};
const link = (href, text, cls) => el("a", { href, class: cls }, text);
const blockLink = (id, text) => link(`#/block/${encodeURIComponent(id)}`, text || id, "mono");
const txLink = (cid, text) => link(`#/tx/${encodeURIComponent(cid)}`, text || short(cid), "mono");
const addrLink = (a, text) => link(`#/address/${encodeURIComponent(a)}`, text || short(a), "mono");

function setView(node) {
  const v = $("#view");
  v.innerHTML = "";
  v.appendChild(node);
  window.scrollTo(0, 0);
}
const spinner = () => el("div", { class: "spinner" }, "Loading…");
function showError(e) {
  const msg = e && e.status === 404 ? "Not found." : (e && e.message) || "Request failed.";
  setView(el("div", { class: "error" }, msg));
}

function kvRows(pairs) {
  return el(
    "div",
    { class: "kv" },
    ...pairs
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) =>
        el("div", { class: "row" }, el("div", { class: "key" }, k), el("div", { class: "val" }, v == null ? "—" : v))
      )
  );
}

/* ------------------------- chain selector ------------------------ */

async function loadChains() {
  const sel = $("#chain-select");
  try {
    const info = await api("/api/chain/info");
    state.chains = info.chains || [];
    sel.innerHTML = "";
    for (const c of state.chains) {
      const path = (c.chainPath || [c.directory]).join("/");
      sel.appendChild(el("option", { value: path }, path));
    }
    if (!state.chain && state.chains.length) state.chain = (state.chains[0].chainPath || [state.chains[0].directory]).join("/");
    if (state.chain) sel.value = state.chain;
  } catch {
    sel.innerHTML = "";
    sel.appendChild(el("option", {}, "Nexus"));
  }
  sel.onchange = () => {
    state.chain = sel.value;
    sessionStorage.setItem("chain", state.chain);
    refreshNetStatus();
    router();
  };
}

/* ----------------------- network status bar ---------------------- */

let netTimer = null;
async function refreshNetStatus() {
  const bar = $("#net-status");
  try {
    const [h, mp] = await Promise.all([api("/health"), api("/api/mempool").catch(() => null)]);
    const cls = h.status === "ok" ? "ok" : h.status === "degraded" ? "degraded" : "unhealthy";
    bar.innerHTML = "";
    bar.appendChild(
      el(
        "div",
        { class: "wrap" },
        el("span", {}, el("span", { class: `dot ${cls}` }), el("b", {}, h.status)),
        el("span", {}, "Height ", el("b", { id: "ns-height" }, num(h.chainHeight))),
        el("span", {}, "Peers ", el("b", {}, num(h.peerCount))),
        mp ? el("span", {}, "Mempool ", el("b", {}, num(mp.count))) : null,
        el("span", {}, h.syncing ? el("span", { class: "pill dim" }, "syncing") : el("span", { class: "pill good" }, "synced")),
        el("span", { class: "hide-sm" }, "Genesis ", el("b", { class: "mono", title: h.genesisHash }, short(h.genesisHash, 8, 6)))
      )
    );
  } catch {
    bar.innerHTML = "";
    bar.appendChild(el("div", { class: "wrap" }, el("span", {}, el("span", { class: "dot down" }), el("b", {}, "node unreachable"))));
  }
}

/* ----------------------------- views ----------------------------- */

async function viewHome() {
  setView(spinner());
  let latest;
  try {
    latest = await api("/api/block/latest");
  } catch (e) {
    return showError(e);
  }
  const tipHeight = Number(latest.height ?? 0);

  const root = el("div");
  root.appendChild(el("h1", {}, "Network overview"));
  root.appendChild(el("p", { class: "sub" }, `Chain: ${esc(state.chain || latest.chain || "Nexus")}`));

  const cards = el("div", { class: "cards" });
  root.appendChild(cards);

  // Spec + mempool + peers cards (best-effort).
  const [spec, mp, peers] = await Promise.all([
    api("/api/chain/spec").catch(() => null),
    api("/api/mempool").catch(() => null),
    api("/api/peers").catch(() => null),
  ]);
  cards.appendChild(card("Tip height", num(tipHeight)));
  cards.appendChild(card("Latest block", blockLink(latest.hash, short(latest.hash, 8, 6)), true));
  if (mp) cards.appendChild(card("Mempool txs", num(mp.count)));
  if (peers) cards.appendChild(card("Peers", num(peers.count)));
  if (spec) {
    cards.appendChild(card("Block time", `${(Number(spec.targetBlockTime) / 1000).toFixed(0)}s`));
    cards.appendChild(card("Block reward", num(spec.initialReward)));
  }

  // Recent blocks.
  root.appendChild(el("h2", {}, "Latest blocks"));
  const tbody = el("tbody");
  const table = el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", {}, "Height"),
          el("th", {}, "Hash"),
          el("th", { class: "num" }, "Txs"),
          el("th", { class: "hide-sm num" }, "Age")
        )
      ),
      tbody
    )
  );
  root.appendChild(table);
  setView(root);

  const count = Math.min(CFG.recentBlocks, tipHeight + 1);
  const heights = Array.from({ length: count }, (_, i) => tipHeight - i).filter((h) => h >= 0);
  const blocks = await Promise.all(heights.map((h) => api(`/api/block/${h}`).catch(() => null)));
  for (const b of blocks) {
    if (!b) continue;
    tbody.appendChild(blockRow(b));
  }
  if (!tbody.children.length) tbody.appendChild(el("tr", {}, el("td", { colspan: 4, class: "empty" }, "No blocks yet.")));

  startLiveBlocks(tbody);
}

function card(k, v, isNode) {
  return el("div", { class: "card" }, el("div", { class: "k" }, k), el("div", { class: isNode ? "v mono" : "v" }, v));
}

function blockRow(b) {
  return el(
    "tr",
    { "data-height": b.height },
    el("td", {}, blockLink(b.height, "#" + num(b.height))),
    el("td", {}, blockLink(b.hash, short(b.hash, 12, 8))),
    el("td", { class: "num" }, num(b.transactionCount ?? 0)),
    el("td", { class: "hide-sm num" }, ago(b.timestamp))
  );
}

async function viewBlock(id) {
  setView(spinner());
  let b;
  try {
    b = await api(`/api/block/${encodeURIComponent(id)}`);
  } catch (e) {
    return showError(e);
  }
  const root = el("div");
  root.appendChild(el("div", { class: "crumbs" }, link("#/", "Home"), " / Block"));
  root.appendChild(el("h1", {}, "Block #" + num(b.height)));
  root.appendChild(el("p", { class: "sub mono" }, b.hash));

  root.appendChild(
    kvRows([
      ["Height", num(b.height)],
      ["Timestamp", `${fmtTime(b.timestamp)} (${ago(b.timestamp)})`],
      ["Hash", el("span", { class: "mono" }, b.hash)],
      ["Parent", b.previousBlock ? blockLink(b.previousBlock, b.previousBlock) : el("span", { class: "pill dim" }, "genesis")],
      ["Transactions", num(b.transactionCount)],
      ["Child blocks", num(b.childBlockCount)],
      ["Nonce", num(b.nonce)],
      ["Version", b.version],
      ["Target", el("span", { class: "mono", title: b.target }, short(b.target, 12, 10))],
      ["Next target", el("span", { class: "mono", title: b.nextTarget }, short(b.nextTarget, 12, 10))],
      ["Transactions CID", el("code", { class: "cid" }, b.transactionsCID)],
      ["Post-state CID", el("code", { class: "cid" }, b.postStateCID)],
      ["Chain", b.chain],
    ])
  );

  if (Number(b.transactionCount) > 0) {
    root.appendChild(el("h2", {}, `Transactions (${num(b.transactionCount)})`));
    const holder = el("div");
    root.appendChild(holder);
    loadBlockTxs(b.hash, holder, 0);
  }
  if (Number(b.childBlockCount) > 0) {
    root.appendChild(el("h2", {}, `Child blocks (${num(b.childBlockCount)})`));
    const holder = el("div");
    root.appendChild(holder);
    loadBlockChildren(b.hash, holder);
  }
  setView(root);
}

async function loadBlockTxs(hash, holder, offset) {
  try {
    const data = await api(`/api/block/${encodeURIComponent(hash)}/transactions`, { limit: 25, offset });
    let table = $(".tx-table", holder);
    let tbody;
    if (!table) {
      tbody = el("tbody");
      table = el(
        "div",
        { class: "table-wrap tx-table" },
        el(
          "table",
          {},
          el("thead", {}, el("tr", {}, el("th", {}, "Tx CID"), el("th", {}, "Signer"), el("th", { class: "num" }, "Fee"), el("th", { class: "num hide-sm" }, "Actions"))),
          tbody
        )
      );
      holder.appendChild(table);
    } else {
      tbody = $("tbody", table);
    }
    for (const t of data.transactions) {
      const actions = (t.accountActionCount || 0) + (t.depositActionCount || 0) + (t.receiptActionCount || 0) + (t.withdrawalActionCount || 0);
      tbody.appendChild(
        el(
          "tr",
          {},
          el("td", {}, txLink(t.txCID)),
          el("td", {}, t.signers && t.signers.length ? addrLink(t.signers[0]) : el("span", { class: "pill dim" }, "—")),
          el("td", { class: "num" }, num(t.fee)),
          el("td", { class: "num hide-sm" }, num(actions))
        )
      );
    }
    const oldBtn = $(".more", holder);
    if (oldBtn) oldBtn.remove();
    if (data.nextOffset != null) {
      holder.appendChild(el("button", { class: "more", onclick: () => loadBlockTxs(hash, holder, data.nextOffset) }, "Load more"));
    }
  } catch (e) {
    holder.appendChild(el("div", { class: "error" }, "Failed to load transactions."));
  }
}

async function loadBlockChildren(hash, holder) {
  try {
    const data = await api(`/api/block/${encodeURIComponent(hash)}/children`, { limit: 100 });
    const tbody = el("tbody");
    for (const c of data.children) {
      tbody.appendChild(
        el(
          "tr",
          {},
          el("td", {}, c.directory),
          el("td", {}, el("span", { class: "mono", title: c.blockHash }, short(c.blockHash, 12, 8))),
          el("td", { class: "num" }, num(c.height)),
          el("td", { class: "num hide-sm" }, num(c.transactionCount))
        )
      );
    }
    holder.appendChild(
      el(
        "div",
        { class: "table-wrap" },
        el(
          "table",
          {},
          el("thead", {}, el("tr", {}, el("th", {}, "Directory"), el("th", {}, "Block"), el("th", { class: "num" }, "Height"), el("th", { class: "num hide-sm" }, "Txs"))),
          tbody
        )
      )
    );
  } catch {
    holder.appendChild(el("div", { class: "error" }, "Failed to load child blocks."));
  }
}

async function viewTx(cid) {
  setView(spinner());
  let t;
  try {
    t = await api(`/api/transaction/${encodeURIComponent(cid)}`);
  } catch (e) {
    return showError(e);
  }
  const root = el("div");
  root.appendChild(el("div", { class: "crumbs" }, link("#/", "Home"), " / Transaction"));
  root.appendChild(el("h1", {}, "Transaction"));
  root.appendChild(el("p", { class: "sub mono" }, t.txCID));

  root.appendChild(
    kvRows([
      ["Tx CID", el("span", { class: "mono" }, t.txCID)],
      ["Block", blockLink(t.blockHeight, "#" + num(t.blockHeight))],
      ["Block hash", blockLink(t.blockHash, t.blockHash)],
      ["Timestamp", `${fmtTime(t.timestamp)} (${ago(t.timestamp)})`],
      ["Fee", num(t.fee)],
      ["Nonce", num(t.nonce)],
      ["Signers", el("div", {}, ...(t.signers || []).map((s) => el("div", {}, addrLink(s, s))))],
      ["Chain path", (t.chainPath || []).join("/") || t.chain],
    ])
  );

  const acts = t.accountActions || [];
  if (acts.length) {
    root.appendChild(el("h2", {}, `Balance changes (${acts.length})`));
    const tbody = el("tbody");
    for (const a of acts) {
      const pos = Number(a.delta) >= 0;
      tbody.appendChild(
        el(
          "tr",
          {},
          el("td", {}, addrLink(a.owner, a.owner)),
          el("td", { class: "num delta" }, `${pos ? "+" : "−"}${num(Math.abs(Number(a.delta)))}`)
        )
      );
    }
    root.appendChild(el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Account"), el("th", { class: "num" }, "Delta"))), tbody)));
  }

  const xfers = (t.depositActions || []).length + (t.receiptActions || []).length + (t.withdrawalActions || []).length;
  if (xfers) {
    root.appendChild(el("h2", {}, "Cross-chain actions"));
    root.appendChild(
      kvRows([
        ["Deposits", num((t.depositActions || []).length)],
        ["Receipts", num((t.receiptActions || []).length)],
        ["Withdrawals", num((t.withdrawalActions || []).length)],
      ])
    );
  }
  setView(root);
}

async function viewAddress(addr) {
  setView(spinner());
  let a;
  try {
    a = await api(`/api/state/account/${encodeURIComponent(addr)}`);
  } catch (e) {
    return showError(e);
  }
  const root = el("div");
  root.appendChild(el("div", { class: "crumbs" }, link("#/", "Home"), " / Account"));
  root.appendChild(el("h1", {}, "Account"));
  root.appendChild(el("p", { class: "sub mono" }, a.address));

  const cards = el("div", { class: "cards" });
  cards.appendChild(card("Balance", num(a.balance)));
  cards.appendChild(card("Nonce", num(a.nonce)));
  cards.appendChild(card("Recent txs", num(a.transactionCount)));
  cards.appendChild(card("Status", el("span", { class: a.exists ? "pill good" : "pill dim" }, a.exists ? "active" : "unseen")));
  root.appendChild(cards);

  const txs = a.recentTransactions || [];
  root.appendChild(el("h2", {}, "Recent transactions"));
  if (!txs.length) {
    root.appendChild(el("div", { class: "empty" }, "No transactions found for this account."));
  } else {
    const tbody = el("tbody");
    for (const t of txs) {
      tbody.appendChild(
        el(
          "tr",
          {},
          el("td", {}, txLink(t.txCID)),
          el("td", {}, blockLink(t.height, "#" + num(t.height))),
          el("td", { class: "mono hide-sm" }, short(t.blockHash, 10, 6))
        )
      );
    }
    root.appendChild(el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Tx CID"), el("th", {}, "Block"), el("th", { class: "hide-sm" }, "Block hash"))), tbody)));
  }
  setView(root);
}

/* ------------------------- live updates (SSE) -------------------- */

let sse = null;
function startLiveBlocks(tbody) {
  if (sse) { sse.close(); sse = null; }
  if (typeof EventSource === "undefined") return;
  try {
    const url = new URL(activeNode() + "/ws");
    url.searchParams.set("events", "newBlock");
    if (state.chain) url.searchParams.set("chainPath", state.chain);
    sse = new EventSource(url);
    // The node frames every event as `data: {"event":...,"data":{...}}` with no
    // SSE `event:` field, so all events arrive via the default message handler.
    sse.onmessage = async (ev) => {
      let env;
      try { env = JSON.parse(ev.data); } catch { return; }
      if (!env || env.event !== "newBlock" || !env.data) return;
      if (!document.body.contains(tbody)) { sse.close(); sse = null; return; }
      const d = env.data;
      // Skip if already shown (poll + SSE overlap).
      if (tbody.querySelector(`tr[data-height="${d.height}"]`)) return;
      const b = await api(`/api/block/${d.height}`).catch(() => null);
      if (!b || !document.body.contains(tbody)) return;
      const row = blockRow(b);
      row.classList.add("new-row");
      tbody.insertBefore(row, tbody.firstChild);
      while (tbody.children.length > CFG.recentBlocks) tbody.removeChild(tbody.lastChild);
      const nh = $("#ns-height");
      if (nh) nh.textContent = num(b.height);
    };
    sse.onerror = () => { /* EventSource auto-reconnects; nothing to do */ };
  } catch { /* SSE unsupported / blocked — home still polls on navigation */ }
}

/* ----------------------------- search ---------------------------- */

async function resolveSearch(q) {
  q = q.trim();
  if (!q) return;
  if (/^\d+$/.test(q)) { location.hash = `#/block/${q}`; return; }
  // Try block hash, then tx CID, then treat as an address.
  try { await api(`/api/block/${encodeURIComponent(q)}`); location.hash = `#/block/${encodeURIComponent(q)}`; return; } catch (e) { if (e.status !== 404) {} }
  try { await api(`/api/transaction/${encodeURIComponent(q)}`); location.hash = `#/tx/${encodeURIComponent(q)}`; return; } catch (e) { if (e.status !== 404) {} }
  location.hash = `#/address/${encodeURIComponent(q)}`;
}

/* ----------------------------- router ---------------------------- */

function router() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean); // e.g. ["block","123"]
  if (parts.length === 0) return viewHome();
  const [route, ...rest] = parts;
  const arg = decodeURIComponent(rest.join("/"));
  if (route === "block" && arg) return viewBlock(arg);
  if (route === "tx" && arg) return viewTx(arg);
  if (route === "address" && arg) return viewAddress(arg);
  return viewHome();
}

/* ------------------------------ boot ----------------------------- */

async function boot() {
  $("#node-link").href = activeNode();
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    resolveSearch($("#search-input").value);
  });
  await loadChains();
  refreshNetStatus();
  netTimer = setInterval(refreshNetStatus, CFG.pollMs);
  window.addEventListener("hashchange", router);
  router();
}

boot();
