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

- `index.html` — the whole site, one page.
- `tokens.css` — vendored design tokens (zero-accent). Source of truth: `lattice-design`.
- `lattice-mark.svg` — the mark (favicon + nav lockup).

No build step, no JavaScript, no web fonts, no images. Open `index.html` directly, or serve the folder statically.

## Deliberately omitted

No token/price/roadmap-hype, team grid, partner logos, illustrations, or animation — each fights the design system. A `/status` page (live height, peers, active chains) is the only planned addition, and only once the network is live and the numbers are real.
