import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionView, ghostTaken } from './automation-execution.ts';

// Trigger → Condição → (Sim) WhatsApp / (Não) Email
const graph = {
  nodes: [
    { id: 't', type: 'message_received', config: {} },
    { id: 'c', type: 'condition', config: {} },
    { id: 'w', type: 'send_whatsapp', config: {} },
    { id: 'm', type: 'send_email', config: {} },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'c', branch: null },
    { id: 'yes', source: 'c', target: 'w', branch: 'yes' },
    { id: 'no', source: 'c', target: 'm', branch: 'no' },
  ],
} as never;

const run = (status = 'completed', extra = {}) => ({ id: 'r', status, current_node_id: null, context: {}, ...extra }) as never;
const step = (node_id: string, node_type: string, status: string, detail: Record<string, unknown> = {}) =>
  ({ node_id, node_type, status, detail }) as never;

test('a true condition lights the "Sim" line and the step after it', () => {
  const view = buildExecutionView(graph, run(), [
    step('t', 'message_received', 'ok'),
    step('c', 'condition', 'ok', { resultado: true }),
    step('w', 'send_whatsapp', 'ok'),
  ]);
  assert.deepEqual([...view.edges].sort(), ['e1', 'yes']);
  assert.equal(view.branches.c, 'yes');
  assert.equal(view.nodes.m, undefined);
});

test('the branch taken is lit even when nothing runs after it', () => {
  const view = buildExecutionView(graph, run(), [
    step('t', 'message_received', 'ok'),
    step('c', 'condition', 'ok', { resultado: false }),
  ]);
  // The "Não" line is a real edge here, and lit although its step never ran.
  assert.ok(view.edges.has('no'));
  assert.ok(!view.edges.has('yes'));
  // Same for a "+" hanging off the branch.
  assert.equal(ghostTaken(view, 'c', 'no'), true);
  assert.equal(ghostTaken(view, 'c', 'yes'), false);
});

test('a failed step lights the line into it and nothing out of it', () => {
  const view = buildExecutionView(graph, run('failed'), [
    step('t', 'message_received', 'ok'),
    step('c', 'condition', 'failed'),
  ]);
  assert.ok(view.edges.has('e1'));
  assert.ok(!view.edges.has('yes') && !view.edges.has('no'));
  assert.equal(ghostTaken(view, 'c', 'yes'), false);
});

test('a run parked on a step shows it waiting before any row exists', () => {
  const view = buildExecutionView(graph, run('awaiting_reply', { current_node_id: 'w' }), [
    step('t', 'message_received', 'ok'),
    step('c', 'condition', 'ok', { resultado: true }),
  ]);
  assert.equal(view.nodes.w, 'waiting');
  assert.ok(view.edges.has('yes'));
});
