import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

/** Every version field a release has to keep in step. */
function versionFields() {
  const root = readJson('package.json');
  const pkg = readJson('dsh-immune-system/package.json');
  const zcode = readJson('dsh-immune-system/.zcode-plugin/plugin.json');
  const market = readJson('marketplace.json');
  const claudePlugin = readJson('.claude-plugin/plugin.json');
  const claudeMarket = readJson('.claude-plugin/marketplace.json');
  const mcpServer = readJson('server.json');
  return {
    'package.json version': root.version,
    'package.json dsh.version': root.dsh?.version,
    'dsh-immune-system/package.json version': pkg.version,
    'dsh-immune-system/package.json dsh.version': pkg.dsh?.version,
    '.zcode-plugin/plugin.json version': zcode.version,
    'marketplace.json plugins[0].version': market.plugins?.[0]?.version,
    '.claude-plugin/plugin.json version': claudePlugin.version,
    '.claude-plugin/marketplace.json plugins[0].version': claudeMarket.plugins?.[0]?.version,
    'server.json version': mcpServer.version,
    'server.json packages[0].version': mcpServer.packages?.[0]?.version,
  };
}

test('all seven manifests agree on one version', () => {
  const fields = versionFields();
  const versions = Object.values(fields);
  assert.equal(
    new Set(versions).size,
    1,
    `manifests drifted: ${JSON.stringify(fields, null, 2)}`,
  );
  assert.match(versions[0], /^\d+\.\d+\.\d+$/u);
});

test('root and nested manifests expose matching CLI bin aliases, SDK exports, and DSH client inject edges', () => {
  const root = readJson('package.json');
  const pkg = readJson('dsh-immune-system/package.json');
  assert.equal(root.bin?.['dsh-immune-system'], 'dsh-immune-system/dist/zcode/src/cli.js');
  assert.equal(root.bin?.immune, 'dsh-immune-system/dist/zcode/src/cli.js');
  assert.equal(pkg.bin?.['dsh-immune-system'], './dist/zcode/src/cli.js');
  assert.equal(pkg.bin?.immune, './dist/zcode/src/cli.js');
  assert.equal(root.exports?.['./core']?.default, './dsh-immune-system/dist/core/index.js');
  assert.equal(root.exports?.['./core']?.types, './dsh-immune-system/dist/core/index.d.ts');
  assert.equal(pkg.exports?.['./core']?.default, './dist/core/index.js');
  assert.equal(pkg.exports?.['./core']?.types, './dist/core/index.d.ts');
  assert.ok(existsSync(join(ROOT, 'dsh-immune-system', 'dist', 'core', 'index.js')));
  assert.ok(existsSync(join(ROOT, 'dsh-immune-system', 'dist', 'core', 'index.d.ts')));
  assert.deepEqual(root.dsh?.client, pkg.dsh?.client);
});

test('the installable package references only files inside itself', () => {
  const pkg = readJson('dsh-immune-system/package.json');
  assert.equal(pkg.name, 'dsh-immune-system');
  assert.equal(pkg.main, './dist/dsh/src/index.js');
  assert.equal(pkg.types, './dist/dsh/src/index.d.ts');
  const rootExport = pkg.exports?.['.'];
  const rootDefault = typeof rootExport === 'string' ? rootExport : rootExport?.default;
  const rootTypes = typeof rootExport === 'string' ? undefined : rootExport?.types;
  assert.equal(rootDefault, './dist/dsh/src/index.js');
  assert.equal(rootTypes, './dist/dsh/src/index.d.ts');
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');

  for (const relative of [pkg.main, pkg.types, rootDefault, rootTypes, pkg.dsh.bundle.patch]) {
    assert.ok(!relative.startsWith('..'), `${relative} escapes the package root`);
    assert.ok(
      existsSync(join(ROOT, 'dsh-immune-system', relative)),
      `${relative} does not exist in the package`,
    );
  }
});

test('the ZCode, marketplace, and MCP registry entries name the same package', () => {
  const pkg = readJson('dsh-immune-system/package.json');
  const zcode = readJson('dsh-immune-system/.zcode-plugin/plugin.json');
  const market = readJson('marketplace.json');
  const mcpServer = readJson('server.json');
  assert.equal(zcode.name, pkg.name);
  assert.equal(market.plugins?.[0]?.name, pkg.name);
  assert.equal(mcpServer.packages?.[0]?.identifier, pkg.name);
});

test('the web client half is declared the way client-modules discovers it', () => {
  const pkg = readJson('dsh-immune-system/package.json');
  assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform must be "web"');

  const clientExport = pkg.exports?.['./client'];
  const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default;
  assert.equal(typeof clientRel, 'string', 'exports["./client"] must resolve to a string');
  assert.ok(!clientRel.startsWith('..'), `${clientRel} escapes the package root`);

  const clientPath = join(ROOT, 'dsh-immune-system', clientRel);
  assert.ok(existsSync(clientPath), `${clientRel} does not exist in the package`);

  const src = readFileSync(clientPath, 'utf8');
  assert.match(src, /window\.__ModuleLoader__\.load\(\{/u, 'bundle must register through the module loader');
  assert.ok(src.includes(`'${pkg.name}'`), `bundle must register under the plugin id ${pkg.name}`);
  assert.match(src, /exports\.apply\s*=/u, 'bundle must export apply (the Cordis plugin face)');
  assert.match(src, /exports\.name\s*=/u, 'bundle must export name');
});
