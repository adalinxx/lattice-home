// Runtime configuration for the explorer. Edit this file to point at a
// different node — no build step required.
window.LATTICE_CONFIG = {
  // Live Nexus mainnet nodes (same chain/genesis), tried in order. Requests
  // fail over to the next on a dead node or a 5xx. CORS on each allows
  // https://adalinxx.github.io.
  nodeUrls: [
    "https://lattice-mainnet-iad.fly.dev",
    "https://lattice-mainnet-ams.fly.dev",
    "https://lattice-mainnet-sjc.fly.dev",
  ],
  // How many recent blocks the home page lists.
  recentBlocks: 15,
  // Poll interval (ms) for the network-status bar when SSE is unavailable.
  pollMs: 6000,
};
