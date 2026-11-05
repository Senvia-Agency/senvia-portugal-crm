import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTION_TYPES, TRIGGER_TYPES, TRIGGER_GROUPS, getNodeBranches } from './automation-nodes.ts';
import type { AutomationGraphNode } from '../types/automations.ts';

const router: AutomationGraphNode = {
  id: 'router', type: 'router', config: { routes: [
    { id: 'priority', label: 'Prioritário', match: 'all', conditions: [{ field: 'value', operator: 'greater_than', value: '1000' }] },
    { id: 'standard', label: 'Normal', match: 'any', conditions: [{ field: 'status', operator: 'equals', value: 'new' }] },
  ] },
};

test('router expõe caminhos em ordem e um fallback permanente', () => {
  assert.deepEqual(getNodeBranches(router), [
    { key: 'priority', label: 'Prioritário' },
    { key: 'standard', label: 'Normal' },
    { key: 'fallback', label: 'Outros casos' },
  ]);
});

test('router vazio conserva saída Outros casos', () => {
  assert.deepEqual(getNodeBranches({ id: 'r', type: 'router', config: {} }), [{ key: 'fallback', label: 'Outros casos' }]);
});

test('catálogo oferece novo bloco de decisão', () => {
  assert.ok(ACTION_TYPES.includes('router'));
});

test('espera por condição possui saída de evento e prazo', () => {
  assert.deepEqual(getNodeBranches({ id: 'wait', type: 'wait_until', config: {} }), [
    { key: 'happened', label: 'Aconteceu' },
    { key: 'timeout', label: 'Prazo esgotado' },
  ]);
});

test('novas ações CRM e espera por condição estão disponíveis', () => {
  for (const type of ['wait_until', 'update_field', 'remove_from_list', 'notify_user']) {
    assert.ok(ACTION_TYPES.some(action => action === type));
  }
});

test('caminho de erro conserva os ramos de decisão', () => {
  assert.deepEqual(getNodeBranches({ ...router, config: { ...router.config, on_error: 'error_branch' } }), [
    { key: 'priority', label: 'Prioritário' }, { key: 'standard', label: 'Normal' },
    { key: 'fallback', label: 'Outros casos' }, { key: 'error', label: 'Erro' },
  ]);
});

test('ação linear com tratamento de erro conserva saída de sucesso', () => {
  assert.deepEqual(getNodeBranches({ id: 'email', type: 'send_email', config: { on_error: 'error_branch' } }), [
    { key: 'default', label: 'Continuar' }, { key: 'error', label: 'Erro' },
  ]);
});

test('divisão A/B usa identificadores estáveis para os ramos', () => {
  assert.deepEqual(getNodeBranches({ id: 'split', type: 'split_ab', config: { variants: [
    { id: 'a', label: 'Texto A', weight: 40 }, { id: 'b', label: 'Texto B', weight: 60 },
  ] } }).map(branch => branch.key), ['a', 'b']);
});


test('todos os gatilhos oferecidos pertencem a exatamente um grupo', () => {
  const grouped = TRIGGER_GROUPS.flatMap(group => group.types);
  for (const type of TRIGGER_TYPES) assert.equal(grouped.filter(item => item === type).length, 1);
});

test('resultado Otto incerto pode seguir para revisão humana', () => {
  for (const type of ['ai_classify', 'ai_summarize', 'ai_extract'] as const) {
    assert.deepEqual(getNodeBranches({ id: type, type, config: {} }).map(branch => branch.key), ['ready', 'review']);
  }
});

test('email conserva percurso linear até ativar espera por evento', () => {
  assert.deepEqual(getNodeBranches({ id: 'email', type: 'send_email', config: {} }), []);
  assert.deepEqual(getNodeBranches({ id: 'email', type: 'send_email', config: { wait_event: 'clicked' } }).map(branch => branch.key), ['happened', 'timeout']);
});

test('pedidos financeiros expõem aprovação em vez de sucesso automático', () => {
  for (const type of ['request_issue_invoice', 'request_issue_receipt', 'request_sale_status', 'request_billing_dispute', 'request_service_suspension'] as const) {
    assert.deepEqual(getNodeBranches({ id: type, type, config: {} }).map(branch => branch.key), ['approval_required']);
  }
});

test('WhatsApp e espera legada expõem resposta alternativa sem perder regras', () => {
  for (const type of ['send_whatsapp', 'wait_reply'] as const) {
    const branches = getNodeBranches({ id: type, type, config: { wait_reply: true, rules: [{ id: 'yes-reply', label: 'Sim', keywords: ['sim'] }] } });
    assert.deepEqual(branches.map(branch => branch.key), ['yes-reply', 'fallback', 'timeout']);
    assert.equal(branches.find(branch => branch.key === 'fallback')?.label, 'Outra resposta');
  }
});

test('mensagem WhatsApp sem espera continua linear', () => {
  assert.deepEqual(getNodeBranches({ id: 'send', type: 'send_whatsapp', config: { message: 'Olá' } }), []);
});
