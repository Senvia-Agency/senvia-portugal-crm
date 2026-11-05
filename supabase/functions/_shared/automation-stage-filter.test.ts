import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesStageTransition } from './automation-stage-filter.ts';

test('de e para exigem simultaneamente transição esperada', () => {
  const config = { from_stage: 'new', to_stage: 'proposal' };
  assert.equal(matchesStageTransition(config, 'proposal', 'new').matches, true);
  assert.equal(matchesStageTransition(config, 'proposal', 'contacted').matches, false);
  assert.equal(matchesStageTransition(config, 'won', 'new').matches, false);
});
test('filtro de origem sem old_record não inscreve em silêncio', () => {
  assert.equal(matchesStageTransition({ from_stage: 'new' }, 'proposal', undefined).matches, false);
});
test('IDs antigos são resolvidos só dentro das etapas fornecidas pela organização', () => {
  const config = { from_stage_id: 'id-new', to_stage_id: 'id-proposal' };
  assert.equal(matchesStageTransition(config, 'proposal', 'new', [{ id: 'id-new', key: 'new' }, { id: 'id-proposal', key: 'proposal' }]).matches, true);
  assert.equal(matchesStageTransition(config, 'proposal', 'new', []).matches, false);
});
test('sem restrição aceita qualquer transição e estado venda usa to_status', () => {
  assert.equal(matchesStageTransition({}, 'anything', undefined).matches, true);
  assert.equal(matchesStageTransition({ to_status: 'active' }, 'pending', undefined).matches, false);
});
