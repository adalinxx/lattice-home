// Runtime configuration for the explorer. Edit this file to point at a
// different node — no build step required.
window.LATTICE_CONFIG = {
  // Live Nexus mainnet nodes (same chain/genesis), tried in order. Requests
  // fail over to the next on a dead node or a 5xx. CORS on each allows
  // https://lattice.build.
  nodeUrls: [
    "https://lattice-mainnet-iad.fly.dev",
    "https://lattice-mainnet-ams.fly.dev",
    "https://lattice-mainnet-sjc.fly.dev",
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
