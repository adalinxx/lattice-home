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
- `token/` — the cross-chain Buy/Sell module. It stages wallet requests and is built to `/token/` during deployment.
- `lattice-mark.svg` — the mark (favicon).
- `.nojekyll` — so GitHub Pages serves the explorer assets raw.

The home page and explorer remain plain static files. The token module uses Vite and is the only build step:

```sh
npm ci --prefix token
npm test --prefix token
npm run build --prefix token
```

Pull requests run the same test and build. The Pages workflow builds in a job that can only read the repository, then publishes the static root and explorer alongside `token/dist` at `/token/` from a separate job that runs no repository code. Everything remains client-side with no website signing bridge or backend.

## Deliberately omitted

No token/price/roadmap-hype, team grid, partner logos, illustrations, or animation — each fights the design system.
