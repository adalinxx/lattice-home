// Runtime configuration for the explorer. Edit this file to point at a
// different node — no build step required.
window.LATTICE_CONFIG = {
  // Every child chain links to its token's Buy/Sell page. That page receives
  // the selected chain path, derives its direct parent, and hands off by QR.
  tokenUrl: ["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? "http://127.0.0.1:5173/"
    : "../token/",
  // Public read surface for Nexus mainnet, tried in order (requests fail over to
  // the next on a dead node or a 5xx). These are read replicas: an nginx
  // allowlist proxy in front of a full node's loopback RPC, exposing only the
  // bounded GET read routes (/health, /api/chain/*, /api/block/*, /api/transaction/*,
  // /api/state/account/*, /api/mempool, /api/peers)
  // with CORS for https://lattice.build. The backbone nodes stay loopback-only
  // and are intentionally NOT listed here.
  nodeUrls: [
    "https://lattice-mainnet-read.fly.dev",
  ],
  // How many recent blocks the home page lists.
  recentBlocks: 15,
  // Poll interval (ms) for the network-status bar when SSE is unavailable.
  pollMs: 6000,
};
