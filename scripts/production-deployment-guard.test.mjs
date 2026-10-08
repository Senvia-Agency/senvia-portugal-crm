import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkOrganizationQuery, checkProductionSource, checkBuildIdentity } from './production-deployment-guard.mjs';

test('rejects the organization wildcard query that caused the outage', () => {
  assert.throws(() => checkOrganizationQuery("client.from('organizations').select('*')"), /wildcard/);
});

test('accepts the current explicit organization query', () => {
  assert.doesNotThrow(() => checkOrganizationQuery(readFileSync('src/contexts/AuthContext.tsx', 'utf8')));
});

test('rejects production builds without a main Git commit', () => {
  assert.throws(() => checkProductionSource({ VERCEL_ENV: 'production' }), /Git main/);
  assert.throws(() => checkProductionSource({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_GIT_COMMIT_REF: 'feature' }), /Git main/);
});

test('accepts production builds from main and rejects stale or local artifacts', () => {
  const sha = 'a'.repeat(40);
  assert.equal(checkProductionSource({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: sha, VERCEL_GIT_COMMIT_REF: 'main' }), 'git');
  assert.doesNotThrow(() => checkBuildIdentity({ schemaVersion: 1, gitSha: sha, source: 'git' }, sha));
  assert.throws(() => checkBuildIdentity({ schemaVersion: 1, gitSha: 'b'.repeat(40), source: 'git' }, sha), /commit/);
  assert.throws(() => checkBuildIdentity({ schemaVersion: 1, gitSha: sha, source: 'local' }, sha), /Git/);
});

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

test('the actual domain verifier rejects stale commits and altered assets', async () => {
  const sha = 'a'.repeat(40);
  const fields = 'id,name,plan,enabled_modules';
  const bundle = `const fields = '${fields}';`;
  const info = { schemaVersion: 1, source: 'git', gitSha: sha, organizationFields: fields, entryBundles: [{ path: '/assets/index-test.js', sha256: createHash('sha256').update(bundle).digest('hex') }] };
  const server = createServer((req, res) => {
    if (req.url.startsWith('/build-info.json')) res.end(JSON.stringify(info));
    else if (req.url.startsWith('/assets/')) res.end(bundle);
    else res.end('<script src="/assets/index-test.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await run(process.execPath, ['scripts/verify-production.mjs', sha, url]);
    assert.match(result.stdout, /Production verified/);
    info.gitSha = 'b'.repeat(40);
    await assert.rejects(run(process.execPath, ['scripts/verify-production.mjs', sha, url]), /commit/);
    info.gitSha = sha;
    info.entryBundles[0].sha256 = '0'.repeat(64);
    await assert.rejects(run(process.execPath, ['scripts/verify-production.mjs', sha, url]), /hash/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
