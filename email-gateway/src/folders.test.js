import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function load() {
  const code = (await readFile(new URL('./commands.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const box = vm.createContext({ console, Buffer, setTimeout, q: async () => [] });
  vm.runInContext(`${code}\nthis.folderName = folderName; this.renamedPath = renamedPath;`, box);
  return box;
}

test('a folder name is trimmed and kept as typed', async () => {
  const { folderName } = await load();
  assert.equal(folderName('  Faturas 2026 '), 'Faturas 2026');
  assert.equal(folderName('Clientes – Açores'), 'Clientes – Açores');
});

test('names that would become a path, a pattern or nothing are refused', async () => {
  const { folderName } = await load();
  for (const bad of ['', '   ', 'a/b', 'a.b', 'a\\b', 'tudo%', 'tudo*', 'com "aspas"', 'x'.repeat(61)]) {
    assert.throws(() => folderName(bad), undefined, bad);
  }
});

test('renaming keeps the folder under the same parent', async () => {
  const { renamedPath } = await load();
  assert.equal(renamedPath('Clientes', '/', 'Parceiros'), 'Parceiros');
  assert.equal(renamedPath('INBOX.Clientes', '.', 'Parceiros'), 'INBOX.Parceiros');
  assert.equal(renamedPath('Projetos/2026/Senvia', '/', 'Realize'), 'Projetos/2026/Realize');
});
