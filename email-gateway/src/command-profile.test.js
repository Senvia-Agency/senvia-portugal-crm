import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

test('gateway accepts only an admin profile belonging to the command organization', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE messaging_channels (id text, organization_id text, channel_type text, assigned_user_ids text[], archived_at timestamptz);
      CREATE TABLE organization_members (organization_id text, user_id text, is_active boolean, role text, profile_id text);
      CREATE TABLE organization_profiles (id text, organization_id text, base_role text);
      INSERT INTO messaging_channels VALUES ('channel-a','org-a','email',ARRAY['other-user']);
      INSERT INTO organization_members VALUES ('org-a','actor',true,'viewer','profile-admin');
      INSERT INTO organization_profiles VALUES ('profile-admin','org-a','admin');`);
    const code = (await readFile(new URL('./commands.js', import.meta.url), 'utf8'))
      .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
    const box = vm.createContext({ console, Buffer,
      q: async (sql, params) => (await db.query(sql, params)).rows,
      getEmailCaixa: async () => ({ id: 'channel-a', organization_id: 'org-a' }),
      getManager: () => ({ client: { usable: true } }) });
    vm.runInContext(code, box);
    const cmd = { created_by: 'actor', channel_id: 'channel-a', organization_id: 'org-a', type: 'fixture' };
    await assert.rejects(box.execute(cmd), /tipo desconhecido/);
    await db.exec("UPDATE organization_profiles SET organization_id='org-b'");
    await assert.rejects(box.execute(cmd), /não autorizado/);
  } finally { await db.close(); }
});
