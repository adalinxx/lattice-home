import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pages = ["index.html", "community/index.html"];
const required = {
  "index.html": ["Docs", "Explorer", "Community", "GitHub"],
  "community/index.html": ["Run a node", "Launch a child chain", "Mine", "Understand the protocol", "Build software", "Help the community"],
};
const ownedGitHubLinks = new Set();

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  assert.match(html, /<html lang="en">/, `${page} declares its language`);
  assert.match(html, /<meta name="viewport"/, `${page} is responsive`);
  assert.match(html, /<nav>/, `${page} has primary navigation`);
  assert.match(html, /aria-label="Lattice home"/, `${page} has an accessible home link`);
  for (const label of required[page]) assert.ok(html.includes(label), `${page} exposes ${label}`);

  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const target = match[1];
    if (target.startsWith("https://github.com/adalinxx/")) { ownedGitHubLinks.add(target); continue; }
    if (/^(?:https?:|mailto:|data:)/.test(target) || target.includes("${")) continue;
    const resolved = new URL(target, new URL(`file://${process.cwd()}/${page}`));
    let path = decodeURIComponent(resolved.pathname);
    if (path.endsWith("/")) path += "index.html";
    assert.ok(existsSync(path), `${page} local target exists: ${target}`);
  }
}

assert.ok(ownedGitHubLinks.has("https://github.com/adalinxx/lattice-node/tree/main/docs"), "Docs has a canonical project destination");
assert.ok(ownedGitHubLinks.has("https://github.com/adalinxx/lattice-node/discussions"), "community forum is linked");
for (const policy of ["CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md"]) {
  assert.ok(ownedGitHubLinks.has(`https://github.com/adalinxx/lattice-node/blob/main/${policy}`), `${policy} has a canonical lattice-node link`);
}
for (const component of ["lattice-node", "nexus-wallet", "lattice-home", "lattice-sdk", "lattice-miner-gpu", "Lattice"]) {
  assert.ok(ownedGitHubLinks.has(`https://github.com/adalinxx/${component}`), `${component} is in the software directory`);
}

console.log("site checks passed");
