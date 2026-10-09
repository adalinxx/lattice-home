// The Nexus read service the page starts from (the explorer's). Child-chain
// nodes are found from it. Override for local development with VITE_NEXUS_URL.
export const NEXUS_NODE: string = (import.meta.env?.VITE_NEXUS_URL as string | undefined)?.replace(/\/$/, "")
  ?? "https://lattice-mainnet-read.fly.dev";

/** The wallet refuses a lattice://order request longer than this. */
export const WALLET_REQUEST_MAX = 16_384;
