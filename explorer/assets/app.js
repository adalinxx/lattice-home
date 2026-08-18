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
// Targets serialize without leading zeros, so a hard target ("0x0000…ffff")
// renders as a wall of f's indistinguishable from the easy genesis target.
// Pad to the full 64 digits and label the work so difficulty is legible.
const padTarget = (t) => (t ? "0x" + String(t).replace(/^0x/, "").padStart(64, "0") : t);
const difficultyBits = (t) => {
  if (!t) return null;
  try {
    const v = BigInt(t);
    return v > 0n ? 256 - v.toString(2).length : null;
  } catch (e) { return null; }
};
const targetEl = (t) => {
  if (!t) return "—";
  const bits = difficultyBits(t);
  return el("span", { class: "mono" },
    hashEl(padTarget(t), 10),
    bits == null ? "" : ` · difficulty ~2^${bits}`
  );
};
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

// live = a node serves the tip; offline = no reachable node is serving it. We intentionally do
// NOT judge "behind/stale" by tip age: a chain's block time is variable (bursty single-miner
// chains especially), so an age threshold just produces confusing false "stale" flags.
function classifyTip(latest, spec) {
  return { status: "live", height: latest.height };
}

const MAX_ENDPOINT_CANDIDATES = 5; // rendezvous list is attacker-controlled; probe only a few

// Bring-your-own-node: a user-supplied endpoint for a chain, persisted only in
// this browser. It is a candidate like any discovered endpoint — verified by
// the same positive genesis match, never trusted for data integrity.
const userEndpointKey = (chainPath) => `lattice-user-endpoint:${chainPath}`;
function userEndpoint(chainPath) {
  try {
    const u = localStorage.getItem(userEndpointKey(chainPath));
    return u && isHttpUrl(u) ? u.replace(/\/$/, "") : null;
  } catch { return null; }
}
function setUserEndpoint(chainPath, url) {
  try {
    if (url) localStorage.setItem(userEndpointKey(chainPath), url);
    else localStorage.removeItem(userEndpointKey(chainPath));
  } catch { /* storage unavailable */ }
  _probe.delete(chainPath);
  _access.delete(chainPath);
}

// A directly-served child node (from GET /api/chain/endpoints on the parent) is TRUSTED only
// on a POSITIVE genesis match against the parent's anchor. Missing anchor or missing/omitted
// served genesisHash → NOT trusted (an attacker who controls the endpoint could otherwise omit
// genesisHash to bypass the check). Non-http(s) URLs are never dialed.
async function verifiedChildEndpoint(childPath, anchorHash) {
  if (!anchorHash) return null; // can't verify without the anchor → treat as unreachable
  let list;
  try { list = (await api("/api/chain/endpoints", { chainPath: childPath })).endpoints || []; }
  catch { list = []; }
  const own = userEndpoint(childPath);
  if (own) list = [{ rpcUrl: own }, ...list];
  for (const e of list.slice(0, MAX_ENDPOINT_CANDIDATES + 1)) {
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
        const own = userEndpoint(sub);
        if (own) list = [{ rpcUrl: own }, ...list];
        let hop = null;
        for (const e of list.slice(0, MAX_ENDPOINT_CANDIDATES + 1)) {
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
    live: ["#38d66b", "live", "a node is serving this chain"],
    offline: ["#8a8f98", "no endpoint", "anchored on its parent (verified); no browser-dialable node discovered — run a node to read this chain, or connect your own"],
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

// Unified search + navigate, rendered above the blocks list: a chain path (e.g. Nexus/toy)
// jumps to that chain; a height, block/tx hash, CID, or address resolves to that item.
function searchBar() {
  const input = el("input", {
    type: "text",
    placeholder: "chain path / height / hash / address",
    "aria-label": "Go to a chain path, or search a height, hash, CID, or address",
    spellcheck: "false",
    autocapitalize: "off",
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

// List the current chain's direct children with live/offline status.
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
  root.appendChild(el("p", { class: "empty" },
    `${chainPath} is anchored on its parent (verified on-chain), but no browser-dialable node was discovered. The chain itself may be perfectly alive — a browser page is a convenience view, not the trust path.`));
  root.appendChild(el("h3", {}, "Read it sovereignly"));
  root.appendChild(el("p", {}, "Any node can join this chain permissionlessly from its on-chain genesis record:"));
  root.appendChild(el("pre", {}, el("code", {}, `lattice child adopt ${chainPath}`)));
  root.appendChild(el("p", {},
    link("https://github.com/adalinxx/lattice-node/blob/main/docs/getting-started.md", "Getting started"),
    " · your own node is the trustless way to read any chain."));
  root.appendChild(el("h3", {}, "Or connect a node you trust"));
  root.appendChild(el("p", {}, "If you know a node serving this chain's public reads, connect it. The choice is stored only in this browser, and its served genesis is verified against the on-chain anchor before use."));
  const input = el("input", {
    type: "url", placeholder: "https://node.example.org",
    value: userEndpoint(chainPath) || "", style: "min-width:22em;margin-right:.6em;",
  });
  const note = el("span", { class: "empty" }, "");
  root.appendChild(el("p", {},
    input,
    el("button", { onclick: async () => {
      const url = input.value.trim().replace(/\/$/, "");
      if (!url) { setUserEndpoint(chainPath, null); note.textContent = "cleared"; return; }
      if (!isHttpUrl(url)) { note.textContent = "not an http(s) URL"; return; }
      note.textContent = "verifying genesis…";
      setUserEndpoint(chainPath, url);
      const parent = chainPath.split("/").slice(0, -1).join("/");
      let anchor = null;
      try {
        const kids = (await backboneGet("/api/chain/children", { chainPath: parent })).children || [];
        anchor = (kids.find((k) => k.chainPath.join("/") === chainPath) || {}).genesisHash;
      } catch { /* anchor unavailable */ }
      const verified = anchor ? await verifiedChildEndpoint(chainPath, anchor) : null;
      if (verified === url) {
        note.textContent = "verified — loading…";
        router();
      } else {
        setUserEndpoint(chainPath, null);
        note.textContent = "endpoint did not serve the anchored genesis; not saved";
      }
    } }, "Connect"),
    " ", note));
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
  // Location cue: breadcrumbs on a child chain, a dashboard title at the root. The search bar
  // (below) also navigates to any chain by path, so the path isn't repeated up here.
  if (state.chain) root.appendChild(chainCrumbs(state.chain));
  else root.appendChild(el("h1", {}, "Network overview"));

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
      ["Target", targetEl(b.target)],
      ["Next target", targetEl(b.nextTarget)],
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
      // Block linkage (height/hash) and the block timestamp are only shown when
      // the node supplies them — a content-addressed node has no tx→block
      // reverse index, so a directly-fetched transaction omits them rather than
      // rendering dead "#—" links.
      ["Block", t.blockHeight != null ? blockLink(t.blockHeight, "#" + num(t.blockHeight)) : undefined],
      ["Block hash", t.blockHash != null ? blockLink(t.blockHash, t.blockHash) : undefined],
      ["Timestamp", t.timestamp != null ? `${fmtTime(t.timestamp)} (${ago(t.timestamp)})` : undefined],
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
  // A chain path (contains a slash, or the root name) navigates to that chain's explorer.
  if (q.includes("/") || q.toLowerCase() === "nexus") {
    const p = q.replace(/^\/+|\/+$/g, "");
    location.hash = !p || p.toLowerCase() === "nexus" ? "#/" : `#/?c=${encodeURIComponent(p)}`;
    return;
  }
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
