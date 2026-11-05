import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutomationTeamFeed } from './AutomationTeamFeed';
import type { AutomationTeamFeedPost } from '@/hooks/useAutomationTeamFeed';

const post: AutomationTeamFeedPost = {
  id: 'post-a', organization_id: 'org-a', title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>\nSegunda linha',
  source_flow_id: 'flow-a', source_run_id: 'run-a', source_node_id: 'node-a:visit:1', source_flow_name: '<b>Equipa</b>', author_id: null, created_at: '2026-11-04T12:00:00Z',
};

test('publicação renderiza título, corpo e origem como texto inerte', () => {
  const html = renderToStaticMarkup(<AutomationTeamFeed posts={[post]} onRefresh={() => {}} />);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;b&gt;Equipa&lt;/b&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<form'));
  assert.ok(html.includes('2026-11-04T12:00:00Z'));
});

test('erro de leitura não se apresenta como feed vazio carregado com sucesso', () => {
  const html = renderToStaticMarkup(<AutomationTeamFeed posts={[]} hasError onRefresh={() => {}} />);
  assert.ok(html.includes('role="alert"'));
  assert.ok(!html.includes('Ainda não há publicações'));
});

test('feed vazio e carregamento têm estados próprios sem publicações inventadas', () => {
  const empty = renderToStaticMarkup(<AutomationTeamFeed posts={[]} onRefresh={() => {}} />);
  const loading = renderToStaticMarkup(<AutomationTeamFeed posts={[]} isLoading onRefresh={() => {}} />);
  assert.ok(empty.includes('Ainda não há publicações'));
  assert.ok(loading.includes('A carregar publicações'));
  assert.ok(!loading.includes('Ainda não há publicações'));
  assert.ok(!empty.includes('<article'));
});
