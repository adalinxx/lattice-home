import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const pages = ["index.html", "community/index.html"];
const required = {
  "index.html": ["Docs", "Explorer", "Community", "GitHub"],
  "community/index.html": ["Run a node", "Launch a child chain", "Mine", "Understand the protocol", "Build software", "Help the community"],
};

for (const page of pages) {
  const html = readFileSync(page, "utf8");
  assert.match(html, /<html lang="en">/, `${page} declares its language`);
  assert.match(html, /<meta name="viewport"/, `${page} is responsive`);
  assert.match(html, /<nav>/, `${page} has primary navigation`);
  assert.match(html, /aria-label="Lattice home"/, `${page} has an accessible home link`);
  for (const label of required[page]) assert.ok(html.includes(label), `${page} exposes ${label}`);

  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|data:)/.test(target) || target.includes("${")) continue;
    const resolved = new URL(target, new URL(`file://${process.cwd()}/${page}`));
    let path = decodeURIComponent(resolved.pathname);
    if (path.endsWith("/")) path += "index.html";
    assert.ok(existsSync(path), `${page} local target exists: ${target}`);
  }
}

for (const policy of ["CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md"]) {
  assert.ok(readFileSync(policy, "utf8").trim().length > 200, `${policy} is substantive`);
}

console.log("site checks passed");
