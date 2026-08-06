// Runtime configuration for the explorer. Edit this file to point at a
// different node — no build step required.
window.LATTICE_CONFIG = {
  // Public read surface for Nexus mainnet, tried in order (requests fail over to
  // the next on a dead node or a 5xx). These are read replicas: an nginx
  // allowlist proxy in front of a full node's loopback RPC, exposing only the
  // bounded GET read routes (/health, /v1/blocks, /v1/transactions, /v1/accounts)
  // with CORS for https://lattice.build. The backbone nodes stay loopback-only
  // and are intentionally NOT listed here.
  nodeUrls: [
    "https://lattice-mainnet-read.fly.dev",
  ],
  // How many recent blocks the home page lists.
  recentBlocks: 15,
  // Poll interval (ms) for the network-status bar when SSE is unavailable.
  pollMs: 6000,
  // Known browsable endpoints for child chains served by a full node as a CHILD
  // (queried WITH ?chainPath=<path>, not at root). The served genesis is still
  // verified against the parent's on-chain anchor before use. Keyed by chainPath.
  childEndpoints: {
    "Nexus/toy": "https://lattice-mainnet-toy.fly.dev",
  },
};
