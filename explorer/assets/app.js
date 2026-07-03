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
  chain: null,         // current chainPath ("Nexus/Mid/…"); null = root (Nexus). From the ?c= hash suffix.
  chainEndpoint: null, // when set, the current chain is served DIRECTLY by this node URL
                       // (discovered + genesis-verified via the rendezvous or config).
  chainEndpointPath: null, // if the endpoint serves this chain as a CHILD (a full node, not a
                       // toy-only node), the chainPath to scope requests with; null = served at root.
};

/* ---------------------------- HTTP ------------------------------- */

function buildUrl(base, path, params) {
  const url = new URL(base + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  return url;
}

// Attacker-controlled child endpoints (from the rendezvous) are fetched as untrusted origins.
// Only ever talk to an http(s) URL, and never hang on a blackholed host.
function isHttpUrl(u) { try { const p = new URL(u).protocol; return p === "https:" || p === "http:"; } catch { return false; } }

// One fetch against an explicit base; throws on !ok (status attached) or timeout. No failover.
async function rawFetch(base, path, params, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(buildUrl(base, path, params), { headers: { Accept: "application/json" }, signal: ctl.signal });
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (res.ok) return body;
    const e = new Error(body && body.error ? body.error : `HTTP ${res.status}`); e.status = res.status; throw e;
  } finally { clearTimeout(t); }
}

// Backbone (root Nexus) request with dead-node/5xx failover. Params passed as-is.
async function backboneGet(path, params) {
  let lastErr;
  for (let attempt = 0; attempt < NODES.length; attempt++) {
    let res;
    try { res = await fetch(buildUrl(activeNode(), path, params), { headers: { Accept: "application/json" } }); }
    catch (e) { lastErr = e; rotateNode(); continue; }
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (res.ok) return body;
    if (res.status >= 500 && attempt < NODES.length - 1) { lastErr = new Error((body && body.error) || `HTTP ${res.status}`); rotateNode(); continue; }
    const e = new Error((body && body.error) || `HTTP ${res.status}`); e.status = res.status; throw e;
  }
  throw lastErr || new Error("All nodes unreachable");
}

// View data source for the CURRENT chain: a directly-served child node (rendezvous) when we
// resolved one, else the backbone proxy scoped by ?chainPath=. An explicit params.chainPath
// (used by probes that target a specific child) always wins over the current chain.
async function api(path, params) {
  if (state.chainEndpoint) {
    // A child-served endpoint (full node serving this chain as a child) needs chainPath scoping;
    // a root-serving node (toy-only) does not.
    const p = state.chainEndpointPath ? { ...(params || {}), chainPath: state.chainEndpointPath } : params;
    return rawFetch(state.chainEndpoint, path, p);
  }
  const p = { ...(params || {}) };
  if (state.chain && p.chainPath == null) p.chainPath = state.chain;
  return backboneGet(path, p);
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
// Full hash in the DOM; CSS middle-truncates only on overflow (.hash in style.css).
// The tail stays pinned so the significant end chars survive truncation.
const hashEl = (s, tail = 8) =>
  !s ? "" : el(
    "span",
    { class: "hash" },
    s.length > tail ? el("span", { class: "head" }, s.slice(0, -tail)) : null,
    el("span", { class: "tail" }, s.slice(-tail))
  );
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
// Preserve the current chain (?c=) across in-chain navigation.
const chainQ = () => (state.chain ? `?c=${encodeURIComponent(state.chain)}` : "");
const blockLink = (id, text) => link(`#/block/${encodeURIComponent(id)}${chainQ()}`, text || id, "mono");
const txLink = (cid, text) => link(`#/tx/${encodeURIComponent(cid)}${chainQ()}`, text || hashEl(cid), "mono");
const addrLink = (a, text) => link(`#/address/${encodeURIComponent(a)}${chainQ()}`, text || hashEl(a), "mono");

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

/* -------------------------- child chains ------------------------- */

// live = served + current; stale = served but behind/syncing; offline = no reachable node.
function classifyTip(latest, spec) {
  const tbt = spec ? Number(spec.targetBlockTime) : 0;
  const fresh = Math.max(tbt * 4, 120000); // tolerate quiet / long-block-time chains
  const age = Date.now() - Number(latest.timestamp || 0);
  return { status: age <= fresh ? "live" : "stale", height: latest.height };
}

const MAX_ENDPOINT_CANDIDATES = 5; // rendezvous list is attacker-controlled; probe only a few

// A directly-served child node (from GET /api/chain/endpoints on the parent) is TRUSTED only
// on a POSITIVE genesis match against the parent's anchor. Missing anchor or missing/omitted
// served genesisHash → NOT trusted (an attacker who controls the endpoint could otherwise omit
// genesisHash to bypass the check). Non-http(s) URLs are never dialed.
async function verifiedChildEndpoint(childPath, anchorHash) {
  if (!anchorHash) return null; // can't verify without the anchor → treat as unreachable
  // Known child-serving endpoint (config): a full node serving this chain as a child. Verify its
  // served genesis (queried WITH chainPath) matches the anchor.
  const known = (window.LATTICE_CONFIG.childEndpoints || {})[childPath];
  if (known && isHttpUrl(known)) {
    try {
      const g = await rawFetch(known, "/api/chain/genesis", { chainPath: childPath });
      if (g.genesisHash === anchorHash) return known;
    } catch { /* dead / no CORS → fall through */ }
  }
  let list;
  try { list = (await api("/api/chain/endpoints", { chainPath: childPath })).endpoints || []; }
  catch { return null; }
  for (const e of list.slice(0, MAX_ENDPOINT_CANDIDATES)) {
    if (!e || !isHttpUrl(e.rpcUrl)) continue;
    try {
      const info = await rawFetch(e.rpcUrl, "/api/chain/info");
      if (info.genesisHash === anchorHash) return e.rpcUrl; // positive match only
    } catch { /* dead / no CORS → next */ }
  }
  return null;
}

// Reachability of a child, from the explorer's vantage. Cached ~30s. Tries the current node's
// proxy first, then the rendezvous (a directly-served, genesis-verified child node).
const _probe = new Map();
async function probeChain(chainPath, anchorHash) {
  const c = _probe.get(chainPath);
  if (c && Date.now() - c.t < 30000) return c;
  let out = { t: Date.now(), status: "offline", height: null, endpoint: null };
  try {
    const [latest, spec] = await Promise.all([
      api("/api/block/latest", { chainPath }),
      api("/api/chain/spec", { chainPath }).catch(() => null),
    ]);
    out = { t: Date.now(), endpoint: null, ...classifyTip(latest, spec) };
  } catch {
    // Proxy can't serve it → rendezvous: a child node serving it directly.
    const ep = await verifiedChildEndpoint(chainPath, anchorHash);
    if (ep) {
      try {
        const [latest, spec] = await Promise.all([
          rawFetch(ep, "/api/block/latest"),
          rawFetch(ep, "/api/chain/spec").catch(() => null),
        ]);
        out = { t: Date.now(), endpoint: ep, ...classifyTip(latest, spec) };
      } catch { /* endpoint died between listing and probe */ }
    }
  }
  _probe.set(chainPath, out);
  return out;
}

// Resolve how to reach `chainPath`: null = backbone proxy (or offline — the view then shows
// offline), a URL = a directly-served child node. PURE w.r.t. globals so a concurrent
// navigation can't corrupt the walk. Cached ~60s. Walks from root level-by-level, hopping
// node→node, and only hops on a POSITIVE genesis match (never trusts an unverifiable endpoint).
const MAX_CHAIN_DEPTH = 8;
const _access = new Map();
async function resolveChainEndpoint(chainPath) {
  if (!chainPath) return { ep: null, path: null };
  const c = _access.get(chainPath);
  if (c && Date.now() - c.t < 60000) return c.val;

  // Known child-serving endpoint (config): a full node serving this chain as a CHILD (queried
  // with chainPath). Verify the served genesis matches the parent's on-chain anchor before use.
  const known = (window.LATTICE_CONFIG.childEndpoints || {})[chainPath];
  if (known && isHttpUrl(known)) {
    try {
      const parent = chainPath.split("/").slice(0, -1).join("/");
      const kids = (await backboneGet("/api/chain/children", { chainPath: parent })).children || [];
      const anchor = (kids.find((k) => k.chainPath.join("/") === chainPath) || {}).genesisHash;
      const g = anchor ? await rawFetch(known, "/api/chain/genesis", { chainPath }) : null;
      if (g && g.genesisHash === anchor) {
        const val = { ep: known, path: chainPath };
        _access.set(chainPath, { val, t: Date.now() });
        return val;
      }
    } catch { /* fall through to rendezvous */ }
  }

  let ep = null;
  try { await backboneGet("/api/block/latest", { chainPath }); } // backbone can proxy it → no direct endpoint needed
  catch {
    const parts = chainPath.split("/");
    if (parts.length <= MAX_CHAIN_DEPTH) {
      let base = null; // null = backbone
      for (let i = 2; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join("/");
        const parent = parts.slice(0, i - 1).join("/");
        let anchor = null, list = [];
        try {
          const kids = (await getFrom(base, "/api/chain/children", { chainPath: parent })).children || [];
          anchor = (kids.find((k) => k.chainPath.join("/") === sub) || {}).genesisHash;
          list = (await getFrom(base, "/api/chain/endpoints", { chainPath: sub })).endpoints || [];
        } catch { base = null; break; }
        if (!anchor) { base = null; break; } // no anchor → can't verify this level → give up
        let hop = null;
        for (const e of list.slice(0, MAX_ENDPOINT_CANDIDATES)) {
          if (!e || !isHttpUrl(e.rpcUrl)) continue;
          try { const info = await rawFetch(e.rpcUrl, "/api/chain/info");
            if (info.genesisHash === anchor) { hop = e.rpcUrl; break; } } catch {} // positive match only
        }
        if (!hop) { base = null; break; }
        base = hop;
      }
      ep = base;
    }
  }
  const val = { ep, path: null }; // rendezvous/walk endpoints serve the chain at root
  _access.set(chainPath, { val, t: Date.now() });
  return val;
}
const getFrom = (base, path, params) => (base ? rawFetch(base, path, params) : backboneGet(path, params));

function statusBadge(status) {
  const S = {
    live: ["#38d66b", "live", "served and current"],
    stale: ["#e5b13a", "stale", "a node serves it, but it's behind the latest / still syncing"],
    offline: ["#8a8f98", "offline", "anchored on its parent, but no reachable node is serving it now"],
    unknown: ["#8a8f98", "…", "checking…"],
  };
  const [color, label, tip] = S[status] || S.unknown;
  return el(
    "span",
    { class: "cbadge", title: tip, style: `display:inline-flex;align-items:center;gap:.45em;color:${color};` },
    el("span", { style: `width:.58em;height:.58em;border-radius:50%;background:${color};display:inline-block;flex:none;` }),
    label
  );
}

// Breadcrumb for a chain path: Nexus / Mid / Stable (each segment linkable).
function chainCrumbs(chainPath) {
  const parts = chainPath.split("/");
  const crumbs = el("div", { class: "crumbs" }, link("#/", parts[0]));
  const acc = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    acc.push(parts[i]);
    const p = acc.join("/");
    crumbs.appendChild(document.createTextNode(" / "));
    crumbs.appendChild(i === parts.length - 1 ? el("span", {}, parts[i]) : link(`#/?c=${encodeURIComponent(p)}`, parts[i]));
  }
  return crumbs;
}

// An address-bar-style input for jumping to any chain by path (e.g. "Nexus/toy").
// Submitting navigates to that chain's explorer view; empty / "Nexus" goes to the root.
function chainBar(currentPath) {
  const input = el("input", {
    type: "text",
    value: currentPath || "Nexus",
    placeholder: "chain path — e.g. Nexus/toy",
    "aria-label": "Go to chain by path",
    spellcheck: "false",
    autocapitalize: "off",
    autocorrect: "off",
    autocomplete: "off",
  });
  const go = () => {
    const v = input.value.trim().replace(/^\/+|\/+$/g, "");
    location.hash = !v || v.toLowerCase() === "nexus" ? "#/" : `#/?c=${encodeURIComponent(v)}`;
  };
  return el("form", { class: "chainbar", onsubmit: (e) => { e.preventDefault(); go(); } },
    el("span", { class: "chainbar-label" }, "Chain"),
    input, el("button", { type: "submit" }, "Go"));
}

// Search the current chain by height / hash / cid / address. Rendered in-page (above the
// blocks list) rather than in the header.
function searchBar() {
  const input = el("input", {
    type: "text",
    placeholder: "height / hash / cid / address",
    "aria-label": "Search by height, hash, CID, or address",
    spellcheck: "false",
    autocomplete: "off",
  });
  return el("form", { class: "search", autocomplete: "off", onsubmit: (e) => { e.preventDefault(); resolveSearch(input.value); } },
    input, el("button", { type: "submit" }, "Find"));
}

// Loading skeleton for the overview: hairline placeholders in the shape the data fills,
// so the first paint reads as structure rather than a bare "Loading…".
function homeSkeleton() {
  const root = el("div");
  root.appendChild(el("div", { class: "sk sk-h1" }));
  const cards = el("div", { class: "cards" });
  for (let i = 0; i < 4; i++) {
    cards.appendChild(el("div", { class: "card" }, el("div", { class: "sk sk-k" }), el("div", { class: "sk sk-v" })));
  }
  root.appendChild(cards);
  const tbody = el("tbody");
  for (let i = 0; i < 6; i++) {
    tbody.appendChild(el("tr", {}, el("td", { colspan: 4 }, el("div", { class: "sk sk-row" }))));
  }
  root.appendChild(el("div", { class: "table-wrap" }, el("table", {}, tbody)));
  return root;
}

// List the current chain's direct children with live/stale/offline status.
async function chainsSection(host) {
  host.appendChild(el("h2", {}, state.chain ? "Sub-chains" : "Child chains"));
  const tbody = el("tbody");
  host.appendChild(
    el("div", { class: "table-wrap" },
      el("table", {},
        el("thead", {}, el("tr", {},
          el("th", {}, "Chain"), el("th", {}, "Status"),
          el("th", { class: "num hide-sm" }, "Height"), el("th", { class: "hide-sm" }, "Genesis"))),
        tbody))
  );
  let kids;
  try {
    kids = (await api("/api/chain/children", { limit: 200 })).children || [];
  } catch {
    tbody.appendChild(el("tr", {}, el("td", { colspan: 4, class: "empty" }, "Couldn't load child chains.")));
    return;
  }
  if (!kids.length) {
    tbody.appendChild(el("tr", {}, el("td", { colspan: 4, class: "empty" }, "No child chains.")));
    return;
  }
  for (const c of kids) {
    const path = c.chainPath.join("/");
    const badgeCell = el("td", {}, statusBadge("unknown"));
    const heightCell = el("td", { class: "num hide-sm" }, "—");
    tbody.appendChild(
      el("tr", {},
        el("td", {}, link(`#/?c=${encodeURIComponent(path)}`, c.directory)),
        badgeCell, heightCell,
        el("td", { class: "hide-sm" }, hashEl(c.genesisHash, 6)))
    );
    probeChain(path, c.genesisHash).then((p) => {
      badgeCell.innerHTML = ""; badgeCell.appendChild(statusBadge(p.status));
      heightCell.textContent = p.height == null ? "—" : num(p.height);
    });
  }
}

function renderOfflineChain(chainPath) {
  const root = el("div");
  root.appendChild(chainCrumbs(chainPath));
  root.appendChild(el("h1", {}, chainPath.split("/").pop()));
  root.appendChild(el("p", { class: "empty" }, `${chainPath} is anchored on its parent, but no reachable node is serving it right now.`));
  setView(root);
}

/* ----------------------------- views ----------------------------- */

async function viewHome() {
  const nav = _nav; // bail before painting if a newer navigation supersedes us
  setView(homeSkeleton());
  let latest;
  try {
    latest = await api("/api/block/latest");
  } catch (e) {
    // A scoped child chain that no reachable node serves: show the anchor, not an error.
    if (state.chain) return renderOfflineChain(state.chain);
    return showError(e);
  }
  const tipHeight = Number(latest.height ?? 0);

  const root = el("div");
  // Location cues: breadcrumbs on a child chain, a dashboard title at the root — the address
  // bar carries the current path either way, so we don't repeat the chain name as an H1.
  if (state.chain) root.appendChild(chainCrumbs(state.chain));
  else root.appendChild(el("h1", {}, "Network overview"));
  root.appendChild(chainBar(state.chain || latest.chain || "Nexus"));

  const cards = el("div", { class: "cards" });
  root.appendChild(cards);

  // Spec + mempool + peers cards (best-effort).
  const [spec, mp, peers] = await Promise.all([
    api("/api/chain/spec").catch(() => null),
    api("/api/mempool").catch(() => null),
    api("/api/peers").catch(() => null),
  ]);
  cards.appendChild(card("Tip height", num(tipHeight)));
  if (mp) cards.appendChild(card("Mempool txs", num(mp.count)));
  // Peers is a node-level metric — only meaningful on the root view, not per child chain.
  if (!state.chain && peers) cards.appendChild(card("Peers", num(peers.count)));
  if (spec) {
    cards.appendChild(card("Block time", `${(Number(spec.targetBlockTime) / 1000).toFixed(0)}s`));
    cards.appendChild(card("Block reward", num(spec.initialReward)));
  }

  // Recent blocks, with in-page search above them.
  root.appendChild(searchBar());
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
  const chainsHost = el("div", { class: "chains" });
  root.appendChild(chainsHost);
  if (nav !== _nav) return; // superseded → don't clobber the newer view
  setView(root);
  chainsSection(chainsHost);

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
    el("td", { class: "shrink" }, blockLink(b.hash, hashEl(b.hash))),
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
      ["Target", el("span", { class: "mono" }, hashEl(b.target, 10))],
      ["Next target", el("span", { class: "mono" }, hashEl(b.nextTarget, 10))],
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
          el("td", { class: "shrink" }, txLink(t.txCID)),
          el("td", { class: "shrink" }, t.signers && t.signers.length ? addrLink(t.signers[0]) : el("span", { class: "pill dim" }, "—")),
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
          el("td", { class: "shrink" }, el("span", { class: "mono" }, hashEl(c.blockHash))),
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
          el("td", { class: "shrink" }, txLink(t.txCID)),
          el("td", {}, blockLink(t.height, "#" + num(t.height))),
          el("td", { class: "mono hide-sm shrink" }, hashEl(t.blockHash, 6))
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

let _nav = 0;
async function router() {
  const myNav = ++_nav; // supersede in-flight navigations
  let hash = location.hash.replace(/^#/, "") || "/";
  // Chain context rides along as ?c=<chainPath> on any route.
  let query = "";
  const qi = hash.indexOf("?");
  if (qi >= 0) { query = hash.slice(qi + 1); hash = hash.slice(0, qi); }
  const chain = new URLSearchParams(query).get("c") || null;
  // Resolve how to reach this chain (backbone proxy vs a directly-served child node via the
  // rendezvous) BEFORE touching globals, then apply atomically — so a faster later navigation
  // can't have its scope corrupted by this one's multi-round-trip resolution.
  const resolved = await resolveChainEndpoint(chain);
  if (myNav !== _nav) return; // a newer navigation started while we resolved → drop this one
  state.chain = chain;
  state.chainEndpoint = resolved.ep;
  state.chainEndpointPath = resolved.path;
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
  window.addEventListener("hashchange", router);
  router();
}

boot();
