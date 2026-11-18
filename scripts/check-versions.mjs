#!/usr/bin/env node
/**
 * Verify that all six version-carrying manifests (8 fields) agree.
 *
 * They drifted once by accident (package.json said 0.2.0 while the plugin
 * manifest said 0.3.8, and .claude-plugin/marketplace.json lagged at 1.0.58),
 * and the npm publish flow publishes from the ROOT manifest while ZCode and
 * Claude Code read their plugin manifests — a mismatch means users install one
 * version while a marketplace advertises another. This check is wired into CI
 * so drift fails the build instead of surfacing in a marketplace.
 *
 * The dsh.version field inside both package.json files must also agree, since
 * the hub displays it as the plugin's version.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const rootPkg = read('package.json');
const nestedPkg = read('dsh-immune-system/package.json');
const pluginManifest = read('dsh-immune-system/.zcode-plugin/plugin.json');
const market = read('marketplace.json');
const claudePlugin = read('.claude-plugin/plugin.json');
const claudeMarket = read('.claude-plugin/marketplace.json');

const versions = {
  'package.json': rootPkg.version,
  'package.json (dsh)': rootPkg.dsh?.version,
  'dsh-immune-system/package.json': nestedPkg.version,
  'dsh-immune-system/package.json (dsh)': nestedPkg.dsh?.version,
  'plugin.json': pluginManifest.version,
  'marketplace.json': market.plugins[0]?.version,
  '.claude-plugin/plugin.json': claudePlugin.version,
  '.claude-plugin/marketplace.json': claudeMarket.plugins?.[0]?.version,
};

let failed = false;
const seen = new Set();
for (const [where, version] of Object.entries(versions)) {
  if (version) seen.add(version);
  console.log(`${version ? 'ok  ' : 'FAIL'} ${where}: ${version ?? '(missing)'}`);
  if (!version) failed = true;
}

if (failed || seen.size > 1) {
  console.error(`\nversion drift: ${[...seen].join(' vs ')} — bump all six manifests together`);
  process.exit(1);
}

for (const [label, name] of [
  ['marketplace.json', market.plugins[0]?.name],
  ['.claude-plugin/plugin.json', claudePlugin.name],
  ['.claude-plugin/marketplace.json', claudeMarket.plugins?.[0]?.name],
]) {
  if (name && name !== rootPkg.name) {
    console.error(`${label} entry name (${name}) != root package name (${rootPkg.name})`);
    process.exit(1);
  }
}

console.log(`\nall 6 manifests (8 version fields) agree on ${rootPkg.version}`);
