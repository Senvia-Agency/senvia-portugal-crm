import assert from 'node:assert/strict';
import test from 'node:test';

import { automationFolderIdFromSelection } from './automation-folder-selection.ts';

test('converts the no-folder choice to a null database value', () => {
  assert.equal(automationFolderIdFromSelection('none'), null);
});

test('preserves the selected folder id for immediate saving', () => {
  assert.equal(automationFolderIdFromSelection('folder-123'), 'folder-123');
});
