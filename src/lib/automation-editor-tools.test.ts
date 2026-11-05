import assert from 'node:assert/strict';
import test from 'node:test';
import { compareAutomationVersions, renderAutomationPreview } from './automation-editor-tools.ts';
test('version comparison ignores layout and reports changed business configuration', () => {
  const before = { graph: { nodes: [{ id: 'a', type: 'send_email', config: { subject: 'Antes' }, position: { x: 0, y: 0 } }], edges: [] } };
  const after = { graph: { nodes: [{ id: 'a', type: 'send_email', config: { subject: 'Depois' }, position: { x: 80, y: 90 } }], edges: [] } };
  assert.deepEqual(compareAutomationVersions(before, after), [{ section: 'Passo send_email', label: 'Assunto', before: 'Antes', after: 'Depois' }]);
});
test('version comparison detects branch changes without depending on edge ids', () => {
  const graph = { nodes: [], edges: [{ id: 'old', source: 'a', target: 'b', branch: 'yes' }] };
  assert.equal(compareAutomationVersions({ graph }, { graph: { ...graph, edges: [{ ...graph.edges[0], id: 'new' }] } }).length, 0);
  assert.equal(compareAutomationVersions({ graph }, { graph: { nodes: [], edges: [] } })[0]?.label, 'Ligação removida');
});
test('protected configuration is never included in readable diff', () => {
  const changes = compareAutomationVersions({ trigger_config: { token: 'old-secret' } }, { trigger_config: { token: 'new-secret' } });
  assert.equal(JSON.stringify(changes).includes('secret'), false);
});
test('HTML preview escapes contact values and identifies unavailable fields', () => {
  assert.deepEqual(renderAutomationPreview('<p>{{nome}} {{ausente}}</p>', { nome: '<script>x</script>' }, true), { text: '<p>&lt;script&gt;x&lt;/script&gt; </p>', missing: ['ausente'] });
});
test('connections between steps of the same type remain distinct', () => {
  const nodes = ['a', 'b', 'c'].map(id => ({ id, type: 'send_email', config: {} }));
  const before = { graph: { nodes, edges: [{ source: 'a', target: 'b' }] } };
  const after = { graph: { nodes, edges: [{ source: 'a', target: 'c' }] } };
  assert.deepEqual(compareAutomationVersions(before, after).map(change => change.label), ['Ligação removida', 'Ligação adicionada']);
});
test('HTML summaries preserve words and normalize whitespace', () => {
  const changes = compareAutomationVersions({ graph: { nodes: [{ id: 'a', type: 'send_email', config: {} }] } }, { graph: { nodes: [{ id: 'a', type: 'send_email', config: { html: '<p>Mensagem simples</p>' } }] } });
  assert.equal(changes[0]?.after, 'Mensagem simples');
});
