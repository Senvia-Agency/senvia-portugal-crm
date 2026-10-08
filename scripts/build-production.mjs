import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkOrganizationQuery, checkProductionSource } from './production-deployment-guard.mjs';

const organizationFields = checkOrganizationQuery(readFileSync('src/contexts/AuthContext.tsx', 'utf8'));
const source = checkProductionSource(process.env);
const gitSha = process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const require = createRequire(import.meta.url);
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const result = spawnSync(process.execPath, [viteCli, 'build'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

const html = readFileSync('dist/index.html', 'utf8');
const entryBundles = [...html.matchAll(/<script[^>]+src="(\/assets\/[^"/]+\.js)"/g)].map(match => {
  const file = readFileSync(path.join('dist', match[1]));
  return { path: match[1], sha256: createHash('sha256').update(file).digest('hex') };
});
if (entryBundles.length === 0) throw new Error('Build has no entry bundle.');
writeFileSync('dist/build-info.json', JSON.stringify({ schemaVersion: 1, gitSha, source, builtAt: new Date().toISOString(), organizationFields, entryBundles }) + '\n');
console.log(`Build identity: ${gitSha} (${source})`);
