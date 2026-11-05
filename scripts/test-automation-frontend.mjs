import { createServer } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
globalThis.document = { documentElement: { lang: '' } };
const server = await createServer({ configFile: false, resolve: { alias: { '@': resolve('src') } }, optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const paths = process.argv.slice(2);
  const tests = paths.length ? paths : readdirSync('src/lib').filter(name => /^automation.*[.]test[.]ts$/.test(name)).map(name => `src/lib/${name}`);
  if (!paths.length) tests.push('src/components/automations/automation-main-compatibility.test.ts');
  for (const file of tests) await server.ssrLoadModule(`/${file}`);
} finally {
  await server.close();
}
