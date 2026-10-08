import { createHash } from 'node:crypto';
import { checkBuildIdentity } from './production-deployment-guard.mjs';

const expectedSha = process.argv[2];
const base = new URL(process.argv[3] || 'https://app.senvia.pt');
if (!expectedSha) throw new Error('Usage: npm run verify:production -- <full-git-sha> [url]');
const response = await fetch(new URL(`/build-info.json?verify=${Date.now()}`, base), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Build identity request failed: ${response.status}`);
const info = await response.json();
checkBuildIdentity(info, expectedSha);
if (!Array.isArray(info.entryBundles) || info.entryBundles.length === 0) throw new Error('Build identity contains no entry bundles.');
const htmlResponse = await fetch(new URL(`/?verify=${Date.now()}`, base), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
if (!htmlResponse.ok) throw new Error(`Frontend request failed: ${htmlResponse.status}`);
const html = await htmlResponse.text();
let organizationQueryFound = false;
for (const entry of info.entryBundles) {
  if (!/^\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(entry.path)) throw new Error('Invalid bundle path.');
  if (!html.includes(entry.path)) throw new Error('HTML serves a different build from its identity.');
  const bundleResponse = await fetch(new URL(entry.path, base), { signal: AbortSignal.timeout(15000) });
  if (!bundleResponse.ok) throw new Error(`Bundle request failed: ${bundleResponse.status}`);
  const bundle = Buffer.from(await bundleResponse.arrayBuffer());
  if (createHash('sha256').update(bundle).digest('hex') !== entry.sha256) throw new Error('Published bundle hash does not match its build identity.');
  organizationQueryFound ||= bundle.toString('utf8').includes(info.organizationFields);
}
if (!organizationQueryFound) throw new Error('Published frontend has no explicit organization query.');
console.log(`Production verified: ${base.origin}, commit ${expectedSha}, bundle hashes and organization query match.`);
