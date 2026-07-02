# lattice-home

The Lattice website — a single static landing page. Text-first, zero-accent, built on the [Lattice design system](https://github.com/adalinxx/lattice-design).

## What it is

A fast, honest front door that routes five audiences into the real substance (docs, spec, code) — it links *out* to `lattice-node/docs` and the repos rather than duplicating them.

- **Evaluator** — hero + three claims (one proof of work · opt-in subscription · no finality)
- **Operator** — Run a node
- **Miner** — Mine (external `lattice-miner`, bundled with lattice-node)
- **Developer** — Build a chain (deploy + policy model)
- **Skeptic** — Spec & security

House line: **One proof. Every chain.**

## Files

- `index.html` — the whole site, one page. Design tokens (zero-accent; source of truth: `lattice-design`) are inlined so it paints in a single request. A small inline script feeds the live Network table from the public seed nodes.
- `explorer/` — the Nexus block explorer, vendored in (client-side, talks to the nodes directly). Served at `/explorer/`.
- `lattice-mark.svg` — the mark (favicon).
- `.nojekyll` — so GitHub Pages serves the explorer assets raw.

No build step, no web fonts, no images. The only JavaScript is the Network status poll and the explorer app — both client-side, no backend. Open `index.html` directly, or serve the folder statically.

## Deliberately omitted

No token/price/roadmap-hype, team grid, partner logos, illustrations, or animation — each fights the design system.
