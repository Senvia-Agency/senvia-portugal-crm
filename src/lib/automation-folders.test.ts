import assert from 'node:assert/strict';
import test from 'node:test';

import { groupAutomationFlows } from './automation-folders.ts';

test('groups automations only by the manually selected folder id', () => {
  const result = groupAutomationFlows(
    [
      { id: 'billing', folder_id: 'agency' },
      { id: 'trial', folder_id: 'os' },
      { id: 'lead', folder_id: null },
      { id: 'unknown', folder_id: 'missing' },
    ],
    [
      { id: 'os', name: 'Senvia OS' },
      { id: 'agency', name: 'Senvia Agency' },
    ],
  );

  assert.deepEqual(result.folders.map((group) => [group.folder.id, group.flows.map((flow) => flow.id)]), [
    ['os', ['trial']],
    ['agency', ['billing']],
  ]);
  assert.deepEqual(result.unfiled.map((flow) => flow.id), ['lead', 'unknown']);
});
