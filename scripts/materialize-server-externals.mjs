/**
 * Turbopack externalizes server packages as hashed names:
 *   .next/node_modules/jsdom-<hash> -> ../../node_modules/jsdom
 * Vercel's file tracer follows those symlinks and ships the real package,
 * but the lambda then fails to resolve the hashed name (empty 500).
 * Replace each symlink with a real copy and list those files in the route trace.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const aliasDir = path.join(root, ".next/node_modules");
const nftPath = path.join(root, ".next/server/app/api/summarize/route.js.nft.json");

if (!fs.existsSync(aliasDir) || !fs.existsSync(nftPath)) {
  process.exit(0);
}

const materialized = [];

for (const name of fs.readdirSync(aliasDir)) {
  const linkPath = path.join(aliasDir, name);
  if (!fs.lstatSync(linkPath).isSymbolicLink()) continue;
  const target = fs.realpathSync(linkPath);
  fs.rmSync(linkPath);
  fs.cpSync(target, linkPath, { recursive: true, dereference: true });
  materialized.push(linkPath);
  console.log(`materialized ${name}`);
}

if (materialized.length === 0) process.exit(0);

const nft = JSON.parse(fs.readFileSync(nftPath, "utf8"));
const nftDir = path.dirname(nftPath);
const files = new Set(nft.files);

function addTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      addTree(full);
      continue;
    }
    if (!entry.isFile()) continue;
    files.add(path.relative(nftDir, full));
  }
}

for (const dir of materialized) addTree(dir);
nft.files = [...files].filter((rel) => {
  const abs = path.resolve(nftDir, rel);
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
});
fs.writeFileSync(nftPath, JSON.stringify(nft));
